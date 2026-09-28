import { and, asc, eq } from "drizzle-orm";
import { getChatGPTUser } from "../../../../chatgpt-auth";
import { getDb } from "../../../../../db";
import { priceHistory, savedItems } from "../../../../../db/schema";
import { ProductFetchError, scrapeProductPage } from "../../../../../lib/product-scraper";

type Context = { params: Promise<{ id: string }> };

async function ownedItem(id: string, userId: string) {
  const [item] = await getDb().select().from(savedItems)
    .where(and(eq(savedItems.id, id), eq(savedItems.userId, userId))).limit(1);
  return item;
}

async function history(id: string, userId: string) {
  return getDb().select({ id: priceHistory.id, price: priceHistory.price, source: priceHistory.source, recordedAt: priceHistory.recordedAt })
    .from(priceHistory).where(and(eq(priceHistory.itemId, id), eq(priceHistory.userId, userId)))
    .orderBy(asc(priceHistory.recordedAt), asc(priceHistory.id));
}

export async function GET(_request: Request, { params }: Context) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "로그인이 필요해요." }, { status: 401 });
  try {
    const { id } = await params;
    if (!await ownedItem(id, user.userId)) return Response.json({ error: "항목을 찾을 수 없어요." }, { status: 404 });
    return Response.json({ history: await history(id, user.userId) });
  } catch {
    return Response.json({ error: "가격 기록을 불러오지 못했어요." }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: Context) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "로그인이 필요해요." }, { status: 401 });
  try {
    const { id } = await params;
    const item = await ownedItem(id, user.userId);
    if (!item) return Response.json({ error: "항목을 찾을 수 없어요." }, { status: 404 });
    const body = await request.json() as { mode?: string; price?: unknown };
    if (body.mode !== "crawl" && body.mode !== "manual") return Response.json({ error: "가격 기록 방식을 확인해 주세요." }, { status: 400 });
    let price: number | null;
    if (body.mode === "crawl") {
      if (!item.url) return Response.json({ error: "상품 링크가 없어요. 가격을 직접 기록해 주세요." }, { status: 422 });
      try { price = (await scrapeProductPage(item.url)).price; }
      catch (error) { return Response.json({ error: error instanceof ProductFetchError ? error.message : "사이트에서 가격을 가져오지 못했어요. 확인한 가격을 직접 기록해 주세요." }, { status: 422 }); }
      if (price === null) return Response.json({ error: "원화 판매가격을 확인하지 못했어요. 가격을 직접 기록해 주세요." }, { status: 422 });
    } else {
      price = typeof body.price === "number" ? body.price : null;
    }
    if (price === null || !Number.isSafeInteger(price) || price < 0) return Response.json({ error: "0 이상의 원화 가격을 입력해 주세요." }, { status: 400 });
    const record = { id: crypto.randomUUID(), itemId: id, userId: user.userId, price, source: body.mode, recordedAt: new Date().toISOString() };
    const db = getDb();
    await db.batch([
      db.insert(priceHistory).values(record),
      db.update(savedItems).set({ price }).where(and(eq(savedItems.id, id), eq(savedItems.userId, user.userId))),
    ]);
    return Response.json({ history: await history(id, user.userId), price });
  } catch {
    return Response.json({ error: "가격 기록을 저장하지 못했어요. 다시 시도해 주세요." }, { status: 500 });
  }
}
