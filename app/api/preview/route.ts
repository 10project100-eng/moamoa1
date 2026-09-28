import { getChatGPTUser } from "../../chatgpt-auth";
import { ProductFetchError, scrapeProductPage } from "../../../lib/product-scraper";

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "로그인이 필요해요." }, { status: 401 });
  try {
    const payload = await request.json() as { url?: string };
    const url = payload.url?.trim() ?? "";
    if (!url || url.length > 2048) return Response.json({ error: "상품 링크를 입력해 주세요." }, { status: 400 });
    const product = await scrapeProductPage(url);
    return Response.json(product);
  } catch (error) {
    if (error instanceof ProductFetchError) {
      console.error("Product preview failed", { code: error.code, upstreamStatus: error.upstreamStatus });
      return Response.json({ error: error.message, code: error.code, upstreamStatus: error.upstreamStatus }, { status: 422 });
    }
    console.error("Product page preview failed:", error);
    return Response.json({ error: "이 페이지의 정보를 읽지 못했어요. 상품 링크를 직접 입력해 주세요." }, { status: 422 });
  }
}
