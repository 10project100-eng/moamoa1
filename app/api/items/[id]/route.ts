import { and, eq } from "drizzle-orm";
import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { getDb } from "../../../../db";
import { savedItemImages, savedItems } from "../../../../db/schema";

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
