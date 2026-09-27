import { desc, eq } from "drizzle-orm";
import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../chatgpt-auth";
import { getDb } from "../../../db";
import { savedItems } from "../../../db/schema";

const categories = new Set(["의류", "가방", "신발", "액세서리", "뷰티", "기타"]);
const maxImageBytes = 10 * 1024 * 1024;

function failure(error: unknown) {
  console.error("Wishlist request failed:", error);
  return Response.json({ error: "저장함에 연결할 수 없어요. 잠시 후 다시 시도해 주세요." }, { status: 500 });
}

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "로그인이 필요해요." }, { status: 401 });
  try {
    const items = await getDb().select().from(savedItems)
      .where(eq(savedItems.userId, user.userId)).orderBy(desc(savedItems.createdAt));
    return Response.json({ items });
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "로그인이 필요해요." }, { status: 401 });
  let imageKey: string | null = null;
  try {
    const form = await request.formData();
    const title = String(form.get("title") ?? "").trim().slice(0, 160);
    const url = String(form.get("url") ?? "").trim().slice(0, 2048);
    const category = String(form.get("category") ?? "기타");
    const note = String(form.get("note") ?? "").trim().slice(0, 600);
    const rawPrice = String(form.get("price") ?? "").trim();
    const price = rawPrice ? Number(rawPrice) : null;
    const image = form.get("image");

    if (!title) return Response.json({ error: "이름을 입력해 주세요." }, { status: 400 });
    if (!categories.has(category)) return Response.json({ error: "카테고리를 확인해 주세요." }, { status: 400 });
    if (url) {
      try {
        const parsed = new URL(url);
        if (!["http:", "https:"].includes(parsed.protocol)) throw new Error();
      } catch { return Response.json({ error: "http 또는 https로 시작하는 링크를 입력해 주세요." }, { status: 400 }); }
    }
    if (price !== null && (!Number.isSafeInteger(price) || price < 0)) {
      return Response.json({ error: "가격은 0 이상의 숫자로 입력해 주세요." }, { status: 400 });
    }
    if (image instanceof File && image.size > 0) {
      if (!image.type.startsWith("image/") || image.size > maxImageBytes) {
        return Response.json({ error: "이미지는 10MB 이하 파일로 선택해 주세요." }, { status: 400 });
      }
      if (!env.BUCKET) throw new Error("R2 binding BUCKET is unavailable");
      imageKey = crypto.randomUUID();
      await env.BUCKET.put(imageKey, image.stream(), { httpMetadata: { contentType: image.type } });
    }
    const [item] = await getDb().insert(savedItems).values({
      id: crypto.randomUUID(), userId: user.userId, title, url, category,
      price, note, imageKey, createdAt: new Date().toISOString(),
    }).returning();
    return Response.json({ item }, { status: 201 });
  } catch (error) {
    if (imageKey && env.BUCKET) await env.BUCKET.delete(imageKey).catch(() => undefined);
    return failure(error);
  }
}
