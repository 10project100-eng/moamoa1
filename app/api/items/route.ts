import { desc, eq } from "drizzle-orm";
import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../chatgpt-auth";
import { getDb } from "../../../db";
import { savedItemImages, savedItems } from "../../../db/schema";
import { downloadProductPhoto, scrapeProductPage } from "../../../lib/product-scraper";

const categories = new Set(["의류", "가방", "신발", "액세서리", "뷰티", "기타"]);
const allowedUploadTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]);
const maxImageBytes = 10 * 1024 * 1024;

function failure(error: unknown) {
  console.error("Wishlist request failed:", error);
  return Response.json({ error: "저장함에 연결할 수 없어요. 잠시 후 다시 시도해 주세요." }, { status: 500 });
}

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "로그인이 필요해요." }, { status: 401 });
  try {
    const db = getDb();
    const items = await db.select().from(savedItems)
      .where(eq(savedItems.userId, user.userId)).orderBy(desc(savedItems.createdAt));
    const photos = await db.select().from(savedItemImages).where(eq(savedItemImages.userId, user.userId));
    const photosByItem = new Map<string, typeof photos>();
    for (const photo of photos) {
      const group = photosByItem.get(photo.itemId) ?? [];
      group.push(photo);
      photosByItem.set(photo.itemId, group);
    }
    return Response.json({ items: items.map((item) => ({
      ...item,
      photos: (photosByItem.get(item.id) ?? []).sort((a, b) => a.position - b.position)
        .map((photo) => ({ id: photo.id, url: `/api/items/${item.id}/photos/${photo.id}` })),
    })) });
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "로그인이 필요해요." }, { status: 401 });
  const uploadedKeys: string[] = [];
  let itemId: string | null = null;
  let uploadedCaptureKey: string | null = null;
  try {
    const form = await request.formData();
    const url = String(form.get("url") ?? "").trim().slice(0, 2048);
    const requestedTitle = String(form.get("title") ?? "").trim().slice(0, 160);
    const category = String(form.get("category") ?? "기타");
    const note = String(form.get("note") ?? "").trim().slice(0, 600);
    const requestedDescription = String(form.get("sourceDescription") ?? "").trim().slice(0, 1200);
    const rawPrice = String(form.get("price") ?? "").trim();
    const requestedPrice = rawPrice ? Number(rawPrice) : null;
    const image = form.get("image");
    let selectedImageUrls: string[] = [];
    try {
      const value = JSON.parse(String(form.get("imageUrls") ?? "[]"));
      if (Array.isArray(value)) selectedImageUrls = value.filter((entry): entry is string => typeof entry === "string").slice(0, 6);
    } catch { return Response.json({ error: "사진 선택 정보를 확인해 주세요." }, { status: 400 }); }

    let page = null;
    if (url) {
      try {
        const parsed = new URL(url);
        if (!["http:", "https:"].includes(parsed.protocol)) throw new Error();
      } catch { return Response.json({ error: "http 또는 https로 시작하는 링크를 입력해 주세요." }, { status: 400 }); }
      try { page = await scrapeProductPage(url); }
      catch (error) {
        if (selectedImageUrls.length || !requestedTitle) {
          const message = error instanceof Error ? error.message : "페이지 정보를 읽지 못했어요.";
          return Response.json({ error: message }, { status: 422 });
        }
      }
    }
    const title = requestedTitle || page?.title || "";
    if (!title) return Response.json({ error: "상품명을 입력해 주세요." }, { status: 400 });
    if (!categories.has(category)) return Response.json({ error: "카테고리를 확인해 주세요." }, { status: 400 });
    const price = requestedPrice ?? page?.price ?? null;
    const sourceDescription = requestedDescription || page?.description || "";
    if (price !== null && (!Number.isSafeInteger(price) || price < 0)) {
      return Response.json({ error: "가격은 0 이상의 숫자로 입력해 주세요." }, { status: 400 });
    }
    const allowedUrls = new Set(page?.imageUrls ?? []);
    const imports = selectedImageUrls.filter((photoUrl) => allowedUrls.has(photoUrl));
    if (selectedImageUrls.length && imports.length !== selectedImageUrls.length) {
      return Response.json({ error: "페이지의 사진 목록이 바뀌었어요. URL을 다시 불러와 주세요." }, { status: 409 });
    }
    if (image instanceof File && image.size > 0) {
      if (!allowedUploadTypes.has(image.type) || image.size > maxImageBytes) {
        return Response.json({ error: "이미지는 10MB 이하 파일로 선택해 주세요." }, { status: 400 });
      }
      if (!env.BUCKET) throw new Error("R2 binding BUCKET is unavailable");
      uploadedCaptureKey = crypto.randomUUID();
      await env.BUCKET.put(uploadedCaptureKey, image.stream(), { httpMetadata: { contentType: image.type } });
      uploadedKeys.push(uploadedCaptureKey);
    }
    if (imports.length && !env.BUCKET) throw new Error("R2 binding BUCKET is unavailable");
    const photos: { id: string; imageKey: string; contentType: string; sourceUrl: string; position: number }[] = [];
    let photoFailures = 0;
    for (const [position, photoUrl] of imports.entries()) {
      try {
        const fetched = await downloadProductPhoto(photoUrl);
        const imageKey = crypto.randomUUID();
        await env.BUCKET!.put(imageKey, fetched.bytes, { httpMetadata: { contentType: fetched.contentType } });
        uploadedKeys.push(imageKey);
        photos.push({ id: crypto.randomUUID(), imageKey, contentType: fetched.contentType, sourceUrl: photoUrl, position });
      } catch { photoFailures++; }
    }
    itemId = crypto.randomUUID();
    const [item] = await getDb().insert(savedItems).values({
      id: itemId, userId: user.userId, title, url, category: page && category === "기타" ? page.category : category,
      price, note, sourceDescription, imageKey: uploadedCaptureKey,
      createdAt: new Date().toISOString(),
    }).returning();
    if (photos.length) await getDb().insert(savedItemImages).values(photos.map((photo) => ({ ...photo, itemId: itemId!, userId: user.userId })));
    return Response.json({
      item: { ...item, photos: photos.map((photo) => ({ id: photo.id, url: `/api/items/${item!.id}/photos/${photo.id}` })) },
      ...(photoFailures ? { warning: `아이템은 저장했지만 사진 ${photoFailures}장은 페이지에서 가져오지 못했어요.` } : {}),
    }, { status: 201 });
  } catch (error) {
    if (itemId) await getDb().delete(savedItems).where(eq(savedItems.id, itemId)).catch(() => undefined);
    if (env.BUCKET) await Promise.all(uploadedKeys.map((key) => env.BUCKET!.delete(key).catch(() => undefined)));
    if (error instanceof Error && "message" in error && /photo|image|사진/i.test(error.message)) {
      return Response.json({ error: "상품 사진을 모두 가져오지 못했어요. URL을 확인하거나 캡처를 직접 올려주세요." }, { status: 422 });
    }
    return failure(error);
  }
}
