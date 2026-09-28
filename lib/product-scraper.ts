const maxPageBytes = 2 * 1024 * 1024;
const maxPhotoBytes = 10 * 1024 * 1024;
export const MAX_IMPORTED_PHOTOS = 20;
const allowedImageTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]);
const redirectStatuses = new Set([301, 302, 303, 307, 308]);

export type ProductPage = {
  brand: string;
  title: string;
  description: string;
  price: number | null;
  category: "의류" | "가방" | "신발" | "액세서리" | "뷰티" | "기타";
  imageUrls: string[];
};

export class ProductFetchError extends Error {
  constructor(message: string, public code = "invalid_page", public upstreamStatus?: number) {
    super(message);
    this.name = "ProductFetchError";
  }
}

function responseError(response: Response, url: URL): ProductFetchError {
  console.error("Product source rejected request", { host: url.hostname, status: response.status, contentType: response.headers.get("content-type") });
  if (response.status === 401 || response.status === 403) return new ProductFetchError("상품 사이트가 모아봄의 접근을 제한했어요. 직접 입력하거나 사진을 올려 저장할 수 있어요.", "access_denied", response.status);
  if (response.status === 429) return new ProductFetchError("상품 사이트의 요청 제한에 걸렸어요. 잠시 후 다시 가져와 주세요.", "rate_limited", 429);
  if (response.status === 404 || response.status === 410) return new ProductFetchError("상품 페이지가 삭제되었거나 주소가 바뀌었어요.", "not_found", response.status);
  return new ProductFetchError(`상품 사이트에서 정보를 읽지 못했어요. (응답 ${response.status})`, "source_error", response.status);
}

function checkedUrl(raw: string): URL {
  let url: URL;
  try { url = new URL(raw); } catch { throw new ProductFetchError("주소를 확인해 주세요."); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new ProductFetchError("http 또는 https 상품 링크를 입력해 주세요.");
  }
  if (url.port && !(url.protocol === "http:" && url.port === "80") && !(url.protocol === "https:" && url.port === "443")) {
    throw new ProductFetchError("표준 웹 주소만 불러올 수 있어요.");
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const normalizedHost = host.replace(/\.$/, "");
  if (!normalizedHost.includes(".") || normalizedHost === "localhost" || normalizedHost.endsWith(".localhost") ||
      normalizedHost.endsWith(".local") || normalizedHost.endsWith(".internal") || normalizedHost.endsWith(".test") ||
      host.includes(":") || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) {
    throw new ProductFetchError("공개 웹사이트 주소만 불러올 수 있어요.");
  }
  url.hash = "";
  return url;
}

async function safeFetch(rawUrl: string, accept: string): Promise<{ response: Response; finalUrl: URL }> {
  let url = checkedUrl(rawUrl);
  for (let redirects = 0; redirects <= 4; redirects++) {
    let response: Response;
    try { response = await fetch(url.toString(), {
      method: "GET",
      redirect: "manual",
      headers: {
        Accept: accept,
        "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.5",
        "User-Agent": "Mozilla/5.0 (compatible; MoaBom/1.0; +https://moabom-wish.sj50507337.chatgpt.site)",
      },
      signal: AbortSignal.timeout(12000),
    }); } catch (error) {
      const name = error instanceof Error ? error.name : "Error";
      console.error("Product source connection failed", { host: url.hostname, name });
      if (name === "TimeoutError" || name === "AbortError") throw new ProductFetchError("상품 사이트 응답이 늦어 중단됐어요. 다시 가져오기를 눌러 주세요.", "timeout");
      throw new ProductFetchError("상품 사이트에 연결하지 못했어요. 잠시 후 다시 가져와 주세요.", "connection_failed");
    }
    if (!redirectStatuses.has(response.status)) return { response, finalUrl: url };
    const location = response.headers.get("location");
    await response.body?.cancel();
    if (!location || redirects === 4) throw new ProductFetchError("페이지 주소가 너무 많이 바뀌어 불러오지 못했어요.");
    url = checkedUrl(new URL(location, url).toString());
  }
  throw new ProductFetchError("페이지를 불러오지 못했어요.");
}

async function readLimited(response: Response, limit: number): Promise<Uint8Array> {
  const advertised = Number(response.headers.get("content-length"));
  if (Number.isFinite(advertised) && advertised > limit) throw new ProductFetchError("페이지 용량이 커서 정보를 읽지 못했어요.");
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new ProductFetchError("페이지 용량이 커서 정보를 읽지 못했어요.");
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
  return output;
}

function codePoint(number: number): string {
  return Number.isFinite(number) && number >= 0 && number <= 0x10ffff && !(number >= 0xd800 && number <= 0xdfff)
    ? String.fromCodePoint(number) : "�";
}

function decode(value: string): string {
  return value
    .replace(/&#x([\da-f]{1,6});?/gi, (_, hex: string) => codePoint(parseInt(hex, 16)))
    .replace(/&#(\d{1,7});?/g, (_, number: string) => codePoint(parseInt(number, 10)))
    .replace(/&(amp|quot|apos|lt|gt|nbsp);/gi, (_, entity: string) => ({
      amp: "&", quot: "\"", apos: "'", lt: "<", gt: ">", nbsp: " ",
    })[entity.toLowerCase()] ?? "")
    .replace(/\s+/g, " ").trim();
}

function plainText(value: string): string {
  return decode(value.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " "));
}

function attributes(tag: string): Record<string, string> {
  const result: Record<string, string> = {};
  const pattern = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  for (const match of tag.matchAll(pattern)) result[match[1].toLowerCase()] = decode(match[2] ?? match[3] ?? match[4] ?? "");
  return result;
}

function categoryFor(value: string): ProductPage["category"] {
  const text = value.toLowerCase();
  if (/bag|handbag|backpack|가방|토트|숄더백/.test(text)) return "가방";
  if (/shoe|sneaker|boots|heel|sandals|신발|운동화|부츠|구두/.test(text)) return "신발";
  if (/beauty|cosmetic|skincare|makeup|뷰티|화장품|스킨케어/.test(text)) return "뷰티";
  if (/jewel|watch|accessor|belt|액세서리|악세서리|주얼리|시계|목걸이|귀걸이|벨트/.test(text)) return "액세서리";
  if (/clothing|apparel|fashion|의류|옷|셔츠|바지|원피스|코트|재킷|니트/.test(text)) return "의류";
  return "기타";
}

function findProducts(value: unknown, product: { brand?: string; name?: string; description?: string; images: string[]; price?: string; currency?: string }, depth = 0): void {
  if (depth > 7 || value == null) return;
  if (Array.isArray(value)) { for (const item of value.slice(0, 40)) findProducts(item, product, depth + 1); return; }
  if (typeof value !== "object") return;
  const object = value as Record<string, unknown>;
  const types = Array.isArray(object["@type"]) ? object["@type"] : [object["@type"]];
  const isProduct = types.some((type) => typeof type === "string" && /product/i.test(type));
  if (isProduct) {
    if (product.name) return;
    const brand = Array.isArray(object.brand) ? object.brand[0] : object.brand;
    if (typeof brand === "string") product.brand = brand;
    else if (brand && typeof brand === "object" && typeof (brand as Record<string, unknown>).name === "string") product.brand = (brand as { name: string }).name;
    if (!product.name && typeof object.name === "string") product.name = object.name;
    if (!product.description && typeof object.description === "string") product.description = object.description;
    const images = object.image;
    const addImage = (image: unknown) => {
      if (typeof image === "string") product.images.push(image);
      else if (image && typeof image === "object" && typeof (image as Record<string, unknown>).url === "string") product.images.push((image as Record<string, string>).url);
    };
    if (Array.isArray(images)) images.forEach(addImage); else addImage(images);
    const offers = Array.isArray(object.offers) ? object.offers[0] : object.offers;
    if (offers && typeof offers === "object") {
      const offer = offers as Record<string, unknown>;
      if (!product.price && (typeof offer.price === "string" || typeof offer.price === "number")) product.price = String(offer.price);
      if (!product.currency && typeof offer.priceCurrency === "string") product.currency = offer.priceCurrency;
    }
  }
  for (const [key, child] of Object.entries(object)) {
    if (key !== "image" && key !== "offers") findProducts(child, product, depth + 1);
  }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown): string { return typeof value === "string" ? value : ""; }

function musinsaDetails(html: string, baseUrl: URL): ProductPage | null {
  if (!/^(www\.|m\.)?musinsa\.com$/.test(baseUrl.hostname)) return null;
  const productId = baseUrl.pathname.match(/\/(?:products|goods)\/(\d+)/)?.[1];
  if (!productId) return null;
  let page: Record<string, unknown> = {};
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (attributes(match[1]).id !== "__NEXT_DATA__") continue;
    try { page = record(record(record(JSON.parse(match[2])).props).pageProps); } catch { return null; }
    break;
  }
  const queries = record(page.dehydratedState).queries;
  let product: Record<string, unknown> = {};
  if (Array.isArray(queries)) {
    for (const query of queries.slice(0, 80)) {
      const candidate = record(record(record(record(query).state).data).data);
      if (String(candidate.goodsNo) === productId) { product = candidate; break; }
    }
  }
  // Metadata is tied to this page; never use another product from recommendations.
  if (!text(product.goodsNm)) product = record(record(page.meta).data);
  if (!text(product.goodsNm)) return null;
  const brand = text(record(product.brandInfo).brandName);
  const contents = text(product.goodsContents);
  const candidates: string[] = [text(product.thumbnailImageUrl)];
  if (Array.isArray(product.goodsImages)) for (const value of product.goodsImages.slice(0, 40)) {
    const photo = record(value);
    candidates.push(typeof value === "string" ? value : text(photo.imageUrl) || text(photo.goodsImageUrl) || text(photo.url));
  }
  const contentImages = [...contents.matchAll(/<img\b[^>]*>/gi)].map((match) => attributes(match[0]));
  // Product-labelled detail images precede generic shop notices and size guides.
  contentImages.sort((a, b) => Number(text(b.alt).includes(text(product.goodsNm))) - Number(text(a.alt).includes(text(product.goodsNm))));
  for (const attrs of contentImages) candidates.push(attrs["data-original"] || attrs["data-src"] || attrs.src || "");
  const imageUrls: string[] = [];
  for (const value of candidates) {
    if (!value || imageUrls.length >= MAX_IMPORTED_PHOTOS || /\/_brand\/|\/brand\/|logo|banner|icon/i.test(value)) continue;
    try {
      const image = checkedUrl(new URL(value, "https://image.msscdn.net").toString()).toString();
      if (!imageUrls.includes(image)) imageUrls.push(image);
    } catch { /* Ignore unsupported image sources. */ }
  }
  const priceData = record(product.goodsPrice);
  const salePrice = Number(priceData.salePrice);
  const price = priceData.currency === "KRW" && priceData.salePrice != null && Number.isSafeInteger(salePrice) && salePrice >= 0 ? salePrice : null;
  return {
    brand: decode(brand).slice(0, 160), title: decode(text(product.goodsNm)).slice(0, 300),
    description: plainText(contents || text(record(product.seo).faceBookMetaDescription)).slice(0, 1200),
    price, category: categoryFor(`${text(product.baseCategoryFullPath)} ${text(product.goodsNm)}`), imageUrls,
  };
}

export function getPageDetails(html: string, baseUrl: URL): ProductPage {
  const musinsa = musinsaDetails(html, baseUrl);
  if (musinsa) return musinsa;
  const meta: Record<string, string[]> = {};
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const attrs = attributes(tag);
    const key = (attrs.property ?? attrs.name ?? attrs.itemprop ?? "").toLowerCase();
    if (key && attrs.content) (meta[key] ??= []).push(attrs.content);
  }
  const first = (...keys: string[]) => keys.map((key) => meta[key]?.[0]).find(Boolean) ?? "";
  const jsonLd: { brand?: string; name?: string; description?: string; images: string[]; price?: string; currency?: string } = { images: [] };
  for (const match of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { findProducts(JSON.parse(match[1].trim()), jsonLd); } catch { /* Ignore malformed product snippets. */ }
  }
  const titleTag = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "";
  const title = decode(jsonLd.name || first("og:title", "twitter:title") || plainText(titleTag)).slice(0, 300);
  const brand = decode(jsonLd.brand || first("product:brand", "og:brand", "brand")).slice(0, 160);
  const description = (jsonLd.description || first("og:description", "twitter:description", "description")).slice(0, 1200);
  const currency = jsonLd.currency || first("product:price:currency", "og:price:currency", "pricecurrency");
  const priceText = jsonLd.price ?? first("product:price:amount", "og:price:amount", "price");
  const numericPrice = priceText.replace(/[,\s₩원]/g, "");
  const parsedPrice = (currency.toUpperCase() === "KRW" || (!currency && /₩|원/.test(priceText))) && /^\d+(\.\d+)?$/.test(numericPrice) ? Number(numericPrice) : NaN;

  const candidates: string[] = [...jsonLd.images];
  for (const key of ["og:image", "og:image:secure_url", "twitter:image", "twitter:image:src"]) candidates.push(...(meta[key] ?? []));
  const tags = html.match(/<img\b[^>]*>/gi) ?? [];
  const imageTagCandidates: { url: string; priority: number }[] = [];
  for (const tag of tags) {
    const attrs = attributes(tag);
    const source = attrs["data-zoom-image"] || attrs["data-original"] || attrs["data-src"] || attrs.src || attrs.srcset?.split(",").at(-1)?.trim().split(/\s+/)[0];
    if (!source) continue;
    const width = Number(attrs.width ?? 0), height = Number(attrs.height ?? 0);
    if ((width > 0 && width < 240) || (height > 0 && height < 240)) continue;
    const hint = `${attrs.alt ?? ""} ${source}`.toLowerCase();
    if (/logo|icon|sprite|avatar|profile|badge|payment|banner|\/_brand\//.test(hint)) continue;
    const priority = (width >= 500 ? 2 : 0) + (/product|goods|item|detail|main|thumb|상품|제품/.test(hint) ? 3 : 0);
    imageTagCandidates.push({ url: source, priority });
  }
  imageTagCandidates.sort((a, b) => b.priority - a.priority);
  candidates.push(...imageTagCandidates.map((candidate) => candidate.url));
  const imageUrls: string[] = [];
  for (const candidate of candidates) {
    if (imageUrls.length >= MAX_IMPORTED_PHOTOS) break;
    try {
      const url = checkedUrl(new URL(candidate, baseUrl).toString()).toString();
      if (!imageUrls.includes(url)) imageUrls.push(url);
    } catch { /* Ignore unsafe, malformed, and non-web image sources. */ }
  }

  return {
    brand, title, description, price: Number.isSafeInteger(parsedPrice) && parsedPrice >= 0 ? parsedPrice : null,
    category: categoryFor(`${title} ${description} ${baseUrl.pathname}`), imageUrls,
  };
}

export async function scrapeProductPage(rawUrl: string): Promise<ProductPage> {
  const { response, finalUrl } = await safeFetch(rawUrl, "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1");
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!response.ok || !(contentType.includes("text/html") || contentType.includes("application/xhtml+xml"))) {
    await response.body?.cancel();
    throw responseError(response, finalUrl);
  }
  const bytes = await readLimited(response, maxPageBytes);
  const charset = contentType.match(/charset\s*=\s*["']?([^;\s"']+)/i)?.[1] ?? "utf-8";
  let html: string;
  try { html = new TextDecoder(charset).decode(bytes); }
  catch { html = new TextDecoder("utf-8").decode(bytes); }
  const details = getPageDetails(html, finalUrl);
  if (!details.title || (/access denied|just a moment|robot check|접근.*차단/i.test(details.title) && !details.brand && details.price === null)) {
    throw new ProductFetchError("상품 사이트가 확인 화면을 표시해 자동으로 읽지 못했어요. 직접 입력하거나 사진을 올려 주세요.", "verification_required");
  }
  return details;
}

export async function downloadProductPhoto(rawUrl: string): Promise<{ bytes: Uint8Array; contentType: string }> {
  const { response, finalUrl } = await safeFetch(rawUrl, "image/avif,image/webp,image/png,image/jpeg,image/gif;q=0.9,*/*;q=0.1");
  const contentType = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ?? "";
  if (!response.ok || !allowedImageTypes.has(contentType)) {
    await response.body?.cancel();
    throw responseError(response, finalUrl);
  }
  return { bytes: await readLimited(response, maxPhotoBytes), contentType };
}
