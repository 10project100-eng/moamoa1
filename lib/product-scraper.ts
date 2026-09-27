const maxPageBytes = 2 * 1024 * 1024;
const maxPhotoBytes = 4 * 1024 * 1024;
const allowedImageTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]);
const redirectStatuses = new Set([301, 302, 303, 307, 308]);

export type ProductPage = {
  title: string;
  description: string;
  price: number | null;
  category: "의류" | "가방" | "신발" | "액세서리" | "뷰티" | "기타";
  imageUrls: string[];
};

export class ProductFetchError extends Error {}

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
    const response = await fetch(url, {
      method: "GET",
      redirect: "manual",
      headers: { Accept: accept },
      signal: AbortSignal.timeout(8000),
    });
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
  if (/jewel|watch|accessor|액세서리|악세서리|주얼리|시계|목걸이|귀걸이/.test(text)) return "액세서리";
  if (/clothing|apparel|fashion|의류|옷|셔츠|바지|원피스|코트|재킷|니트/.test(text)) return "의류";
  return "기타";
}

function findProducts(value: unknown, product: { name?: string; description?: string; images: string[]; price?: string; currency?: string }, depth = 0): void {
  if (depth > 7 || value == null) return;
  if (Array.isArray(value)) { for (const item of value.slice(0, 40)) findProducts(item, product, depth + 1); return; }
  if (typeof value !== "object") return;
  const object = value as Record<string, unknown>;
  const types = Array.isArray(object["@type"]) ? object["@type"] : [object["@type"]];
  const isProduct = types.some((type) => typeof type === "string" && /product/i.test(type));
  if (isProduct) {
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

function getPageDetails(html: string, baseUrl: URL): ProductPage {
  const meta: Record<string, string[]> = {};
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const attrs = attributes(tag);
    const key = (attrs.property ?? attrs.name ?? attrs.itemprop ?? "").toLowerCase();
    if (key && attrs.content) (meta[key] ??= []).push(attrs.content);
  }
  const first = (...keys: string[]) => keys.map((key) => meta[key]?.[0]).find(Boolean) ?? "";
  const jsonLd: { name?: string; description?: string; images: string[]; price?: string; currency?: string } = { images: [] };
  for (const match of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { findProducts(JSON.parse(match[1].trim()), jsonLd); } catch { /* Ignore malformed product snippets. */ }
  }
  const titleTag = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "";
  const title = (jsonLd.name || first("og:title", "twitter:title") || plainText(titleTag)).slice(0, 160);
  const description = (jsonLd.description || first("og:description", "twitter:description", "description")).slice(0, 1200);
  const currency = first("product:price:currency", "og:price:currency") || jsonLd.currency || "KRW";
  const priceText = first("product:price:amount", "og:price:amount") || jsonLd.price || "";
  const parsedPrice = currency.toUpperCase() === "KRW" ? Number(priceText.replace(/[^\d.]/g, "")) : NaN;

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
    if (/logo|icon|sprite|avatar|profile|badge|payment|banner/.test(hint)) continue;
    const priority = (width >= 500 ? 2 : 0) + (/product|goods|item|detail|main|thumb|상품|제품/.test(hint) ? 3 : 0);
    imageTagCandidates.push({ url: source, priority });
  }
  imageTagCandidates.sort((a, b) => b.priority - a.priority);
  candidates.push(...imageTagCandidates.map((candidate) => candidate.url));
  const imageUrls: string[] = [];
  for (const candidate of candidates) {
    if (imageUrls.length >= 6) break;
    try {
      const url = checkedUrl(new URL(candidate, baseUrl).toString()).toString();
      if (!imageUrls.includes(url)) imageUrls.push(url);
    } catch { /* Ignore unsafe, malformed, and non-web image sources. */ }
  }

  return {
    title, description, price: Number.isFinite(parsedPrice) ? Math.round(parsedPrice) : null,
    category: categoryFor(`${title} ${description} ${baseUrl.pathname}`), imageUrls,
  };
}

export async function scrapeProductPage(rawUrl: string): Promise<ProductPage> {
  const { response, finalUrl } = await safeFetch(rawUrl, "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1");
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!response.ok || !(contentType.includes("text/html") || contentType.includes("application/xhtml+xml"))) {
    await response.body?.cancel();
    throw new ProductFetchError("이 페이지에서 상품 정보를 읽을 수 없어요. 링크를 확인해 주세요.");
  }
  const bytes = await readLimited(response, maxPageBytes);
  const charset = contentType.match(/charset\s*=\s*["']?([^;\s"']+)/i)?.[1] ?? "utf-8";
  let html: string;
  try { html = new TextDecoder(charset).decode(bytes); }
  catch { html = new TextDecoder("utf-8").decode(bytes); }
  const details = getPageDetails(html, finalUrl);
  if (!details.title) details.title = finalUrl.hostname.replace(/^www\./, "");
  return details;
}

export async function downloadProductPhoto(rawUrl: string): Promise<{ bytes: Uint8Array; contentType: string }> {
  const { response } = await safeFetch(rawUrl, "image/avif,image/webp,image/png,image/jpeg,image/gif;q=0.9,*/*;q=0.1");
  const contentType = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ?? "";
  if (!response.ok || !allowedImageTypes.has(contentType)) {
    await response.body?.cancel();
    throw new ProductFetchError("상품 사진을 가져오지 못했어요.");
  }
  return { bytes: await readLimited(response, maxPhotoBytes), contentType };
}
