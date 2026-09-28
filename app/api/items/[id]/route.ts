import { and, eq, inArray } from "drizzle-orm";
import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { getDb } from "../../../../db";
import { priceHistory, savedItemImages, savedItems } from "../../../../db/schema";
import { validatePhotoFiles } from "../../../../lib/photo-upload";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "로그인이 필요해요." }, { status: 401 });
  let uploadedKey: string | null = null;
  const uploadedKeys: string[] = [];
  let committed = false;
  try {
    const { id } = await params;
    const db = getDb();
    const owned = and(eq(savedItems.id, id), eq(savedItems.userId, user.userId));
    const [item] = await db.select().from(savedItems).where(owned).limit(1);
    if (!item) return Response.json({ error: "항목을 찾을 수 없어요." }, { status: 404 });
    const form = await request.formData();
    const readText = (key: string, fallback: string) => form.has(key) ? String(form.get(key) ?? "").trim() : fallback;
    const title = readText("title", item.title);
    const brand = readText("brand", item.brand);
    const url = readText("url", item.url);
    const category = readText("category", item.category);
    const note = readText("note", item.note);
    const sourceDescription = readText("sourceDescription", item.sourceDescription);
    if (!title || title.length > 300) return Response.json({ error: "제품명은 1~300자로 입력해 주세요." }, { status: 400 });
    if (brand.length > 160 || note.length > 600 || sourceDescription.length > 1200 || url.length > 2048) {
      return Response.json({ error: "입력 가능한 글자 수를 초과했어요." }, { status: 400 });
    }
    if (!["의류", "가방", "신발", "액세서리", "뷰티", "기타"].includes(category)) return Response.json({ error: "카테고리를 확인해 주세요." }, { status: 400 });
    if (url) {
      try { const parsed = new URL(url); if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error(); }
      catch { return Response.json({ error: "http 또는 https로 시작하는 상품 링크를 입력해 주세요." }, { status: 400 }); }
    }
    const rawPrice = readText("price", item.price === null ? "" : String(item.price));
    const price = rawPrice === "" ? null : Number(rawPrice);
    if (price !== null && (!/^\d+$/.test(rawPrice) || !Number.isSafeInteger(price) || price < 0)) return Response.json({ error: "가격은 0 이상의 정수로 입력해 주세요." }, { status: 400 });
    const photos = await db.select().from(savedItemImages).where(and(eq(savedItemImages.itemId, id), eq(savedItemImages.userId, user.userId)));
    let removedIds: string[];
    try {
      const value: unknown = JSON.parse(String(form.get("removePhotoIds") ?? "[]"));
      if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || !photos.some((photo) => photo.id === entry))) throw new Error();
      removedIds = [...new Set(value as string[])];
    } catch { return Response.json({ error: "삭제할 사진 정보를 확인해 주세요." }, { status: 400 }); }
    const removeCapture = form.get("removeCapture") === "true";
    const keptPhotos = photos.filter((photo) => !removedIds.includes(photo.id));
    const uploads = form.getAll("images");
    if (uploads.some((file) => !(file instanceof File))) return Response.json({ error: "사진 파일을 확인해 주세요." }, { status: 400 });
    const files = uploads as File[];
    const image = form.get("image");
    const replacement = image instanceof File && image.size > 0 ? image : null;
    const photoError = validatePhotoFiles([...files, ...(replacement ? [replacement] : [])], keptPhotos.length + (item.imageKey && !removeCapture && !replacement ? 1 : 0));
    if (photoError) return Response.json({ error: photoError }, { status: 400 });
    if (image instanceof File && image.size > 0) {
      if (!["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"].includes(image.type) || image.size > 10 * 1024 * 1024) {
        return Response.json({ error: "사진은 JPG, PNG, WEBP, GIF, AVIF 형식의 10MB 이하 파일을 선택해 주세요." }, { status: 400 });
      }
      if (!env.BUCKET) throw new Error("Missing photo storage");
      uploadedKey = crypto.randomUUID();
      uploadedKeys.push(uploadedKey);
      await env.BUCKET.put(uploadedKey, image.stream(), { httpMetadata: { contentType: image.type } });
    }
    const newPhotos: (typeof savedItemImages.$inferInsert)[] = [];
    const nextPosition = Math.max(-1, ...keptPhotos.map((photo) => photo.position)) + 1;
    if (files.length && !env.BUCKET) throw new Error("Missing photo storage");
    for (const [index, file] of files.entries()) {
      const imageKey = crypto.randomUUID();
      uploadedKeys.push(imageKey);
      await env.BUCKET!.put(imageKey, file.stream(), { httpMetadata: { contentType: file.type } });
      newPhotos.push({ id: crypto.randomUUID(), itemId: id, userId: user.userId, imageKey, contentType: file.type, sourceUrl: "", position: nextPosition + index });
    }
    const update = db.update(savedItems).set({ title, brand, url, category, price, note, sourceDescription, imageKey: uploadedKey ?? (removeCapture ? null : item.imageKey) }).where(owned).returning();
    const results = await db.batch([
      update,
      ...(price !== null && price !== item.price ? [db.insert(priceHistory).values({ id: crypto.randomUUID(), itemId: id, userId: user.userId, price, source: "manual", recordedAt: new Date().toISOString() })] : []),
      ...(removedIds.length ? [db.delete(savedItemImages).where(and(eq(savedItemImages.itemId, id), eq(savedItemImages.userId, user.userId), inArray(savedItemImages.id, removedIds)))] : []),
      ...Array.from({ length: Math.ceil(newPhotos.length / 10) }, (_, index) => db.insert(savedItemImages).values(newPhotos.slice(index * 10, index * 10 + 10))),
    ]);
    committed = true;
    const removedKeys = [...photos.filter((photo) => removedIds.includes(photo.id)).map((photo) => photo.imageKey), ...((uploadedKey || removeCapture) && item.imageKey ? [item.imageKey] : [])];
    if (env.BUCKET) await Promise.all(removedKeys.map((key) => env.BUCKET!.delete(key).catch(() => undefined)));
    return Response.json({ item: { ...results[0][0], photos: [...keptPhotos, ...newPhotos].sort((a, b) => a.position - b.position).map((photo) => ({ id: photo.id, url: `/api/items/${id}/photos/${photo.id}` })) } });
  } catch (error) {
    if (!committed && env.BUCKET) await Promise.all(uploadedKeys.map((key) => env.BUCKET!.delete(key).catch(() => undefined)));
    console.error("Wishlist edit failed:", error);
    return Response.json({ error: "수정 내용을 저장하지 못했어요. 다시 시도해 주세요." }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "로그인이 필요해요." }, { status: 401 });
  try {
    const { id } = await params;
    const db = getDb();
    const [item] = await db.select().from(savedItems)
      .where(and(eq(savedItems.id, id), eq(savedItems.userId, user.userId))).limit(1);
    if (!item) return Response.json({ error: "항목을 찾을 수 없어요." }, { status: 404 });
    const photos = await db.select().from(savedItemImages).where(and(eq(savedItemImages.itemId, id), eq(savedItemImages.userId, user.userId)));
    await db.delete(savedItems).where(and(eq(savedItems.id, id), eq(savedItems.userId, user.userId)));
    if (env.BUCKET) {
      const keys = [...(item.imageKey ? [item.imageKey] : []), ...photos.map((photo) => photo.imageKey)];
      await Promise.all(keys.map((key) => env.BUCKET!.delete(key).catch(() => undefined)));
    }
    return Response.json({ ok: true });
  } catch (error) {
    console.error("Wishlist delete failed:", error);
    return Response.json({ error: "삭제하지 못했어요. 잠시 후 다시 시도해 주세요." }, { status: 500 });
  }
}
