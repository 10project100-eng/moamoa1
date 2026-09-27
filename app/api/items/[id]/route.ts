import { and, eq } from "drizzle-orm";
import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { getDb } from "../../../../db";
import { priceHistory, savedItemImages, savedItems } from "../../../../db/schema";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "로그인이 필요해요." }, { status: 401 });
  let uploadedKey: string | null = null;
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
    const image = form.get("image");
    if (image instanceof File && image.size > 0) {
      if (!["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"].includes(image.type) || image.size > 10 * 1024 * 1024) {
        return Response.json({ error: "사진은 JPG, PNG, WEBP, GIF, AVIF 형식의 10MB 이하 파일을 선택해 주세요." }, { status: 400 });
      }
      if (!env.BUCKET) throw new Error("Missing photo storage");
      uploadedKey = crypto.randomUUID();
      await env.BUCKET.put(uploadedKey, image.stream(), { httpMetadata: { contentType: image.type } });
    }
    const update = db.update(savedItems).set({ title, brand, url, category, price, note, sourceDescription, imageKey: uploadedKey ?? item.imageKey }).where(owned).returning();
    const results = price !== null && price !== item.price
      ? await db.batch([update, db.insert(priceHistory).values({ id: crypto.randomUUID(), itemId: id, userId: user.userId, price, source: "manual", recordedAt: new Date().toISOString() })])
      : await db.batch([update]);
    committed = true;
    if (uploadedKey && item.imageKey && env.BUCKET) await env.BUCKET.delete(item.imageKey).catch(() => undefined);
    return Response.json({ item: { ...results[0][0], photos: photos.sort((a, b) => a.position - b.position).map((photo) => ({ id: photo.id, url: `/api/items/${id}/photos/${photo.id}` })) } });
  } catch (error) {
    if (!committed && uploadedKey && env.BUCKET) await env.BUCKET.delete(uploadedKey).catch(() => undefined);
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
