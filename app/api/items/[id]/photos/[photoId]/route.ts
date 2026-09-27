import { and, eq } from "drizzle-orm";
import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../../../../chatgpt-auth";
import { getDb } from "../../../../../../db";
import { savedItemImages } from "../../../../../../db/schema";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; photoId: string }> }) {
  const user = await getChatGPTUser();
  if (!user) return new Response("로그인이 필요해요.", { status: 401 });
  try {
    const { id, photoId } = await params;
    const [photo] = await getDb().select().from(savedItemImages)
      .where(and(eq(savedItemImages.id, photoId), eq(savedItemImages.itemId, id), eq(savedItemImages.userId, user.userId))).limit(1);
    if (!photo || !env.BUCKET) return new Response("사진을 찾을 수 없어요.", { status: 404 });
    const object = await env.BUCKET.get(photo.imageKey);
    if (!object) return new Response("사진을 찾을 수 없어요.", { status: 404 });
    return new Response(object.body, { headers: {
      "Content-Type": photo.contentType,
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    } });
  } catch (error) {
    console.error("Saved product photo fetch failed:", error);
    return new Response("사진을 불러오지 못했어요.", { status: 500 });
  }
}
