import { and, eq } from "drizzle-orm";
import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../../../chatgpt-auth";
import { getDb } from "../../../../../db";
import { savedItems } from "../../../../../db/schema";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getChatGPTUser();
  if (!user) return new Response("로그인이 필요해요.", { status: 401 });
  try {
    const { id } = await params;
    const [item] = await getDb().select().from(savedItems)
      .where(and(eq(savedItems.id, id), eq(savedItems.userId, user.userId))).limit(1);
    if (!item?.imageKey || !env.BUCKET) return new Response("이미지를 찾을 수 없어요.", { status: 404 });
    const image = await env.BUCKET.get(item.imageKey);
    if (!image) return new Response("이미지를 찾을 수 없어요.", { status: 404 });
    return new Response(image.body, { headers: {
      "Content-Type": image.httpMetadata?.contentType ?? "application/octet-stream",
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    } });
  } catch (error) {
    console.error("Wishlist image fetch failed:", error);
    return new Response("이미지를 불러오지 못했어요.", { status: 500 });
  }
}
