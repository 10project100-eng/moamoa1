"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight, Bookmark, Check, ChevronDown, ExternalLink, ImagePlus, Link2, LoaderCircle, Plus, Search, Sparkles, Trash2, X } from "lucide-react";

type Category = "의류" | "가방" | "신발" | "액세서리" | "뷰티" | "기타";
type SavedItem = {
  id: string; title: string; url: string; category: Category; price: number | null;
  note: string; sourceDescription?: string; imageKey: string | null; createdAt: string;
  photos?: { id: string; url: string }[];
};
type ScrapedPreview = { title: string; description: string; price: number | null; category: Category; imageUrls: string[] };
const categories: Category[] = ["의류", "가방", "신발", "액세서리", "뷰티", "기타"];
const money = new Intl.NumberFormat("ko-KR");

export function Wishlist({ displayName }: { displayName: string }) {
  const [items, setItems] = useState<SavedItem[]>([]);
  const [activeCategory, setActiveCategory] = useState("전체");
  const [query, setQuery] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [removing, setRemoving] = useState<string | null>(null);

  async function loadItems() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/items", { cache: "no-store" });
      const data = await response.json() as { items: SavedItem[]; error?: string };
      if (!response.ok) throw new Error(data.error ?? "보관함을 불러오지 못했어요.");
      setItems(data.items);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "보관함을 불러오지 못했어요.");
    } finally { setLoading(false); }
  }

  useEffect(() => { void loadItems(); }, []);

  const visibleItems = useMemo(() => items.filter((item) => {
    const matchesCategory = activeCategory === "전체" || item.category === activeCategory;
    const needle = query.trim().toLocaleLowerCase();
    const matchesQuery = !needle || [item.title, item.note, item.category, item.url]
      .some((value) => value.toLocaleLowerCase().includes(needle));
    return matchesCategory && matchesQuery;
  }), [items, activeCategory, query]);

  async function removeItem(item: SavedItem) {
    if (!window.confirm(`‘${item.title}’을(를) 보관함에서 지울까요?`)) return;
    setRemoving(item.id);
    try {
      const response = await fetch(`/api/items/${item.id}`, { method: "DELETE" });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "삭제하지 못했어요.");
      setItems((current) => current.filter((saved) => saved.id !== item.id));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "삭제하지 못했어요."); }
    finally { setRemoving(null); }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="모아봄 홈"><span className="brand-mark">m.</span><span>모아봄</span></a>
        <div className="topbar-note"><span className="status-dot" /> 나만의 위시리스트</div>
        <div className="topbar-user"><span className="avatar">{displayName.slice(0, 1).toUpperCase()}</span><span>{displayName}</span><ChevronDown size={15} /></div>
      </header>

      <div className="workspace">
        <aside className="side-rail">
          <div className="rail-label">내 보관함</div>
          <button className="rail-item rail-item-active" onClick={() => { setActiveCategory("전체"); setQuery(""); }}>
            <Bookmark size={17} strokeWidth={1.8} /><span>모아둔 아이템</span><span className="rail-count">{items.length}</span>
          </button>
          <div className="rail-divider" />
          <div className="rail-label rail-category-label">카테고리</div>
          {categories.map((category, index) => (
            <button key={category} className={`rail-item ${activeCategory === category ? "rail-item-selected" : ""}`} onClick={() => setActiveCategory(category)}>
              <span className={`category-bullet bullet-${index}`} /><span>{category}</span>
              <span className="rail-count">{items.filter((item) => item.category === category).length}</span>
            </button>
          ))}
          <div className="rail-tip"><Sparkles size={15} /><p>언젠가 살 마음을<br />오늘 가볍게 모아두기.</p></div>
        </aside>

        <section className="main-content">
          <div className="page-heading">
            <div>
              <p className="eyebrow">YOUR SAVED THINGS</p>
              <h1>사고 싶은 것들 <span>모아봄</span></h1>
              <p className="page-subtitle">지금은 아니어도, 마음에 든 순간은 남겨두세요.</p>
            </div>
            <button className="primary-button add-button" onClick={() => setIsAdding(true)}><Plus size={18} strokeWidth={2.2} /> <span>아이템 담기</span></button>
          </div>

          <div className="collection-bar">
            <div className="collection-title"><span className="collection-marker" /> 내 위시리스트 <span className="collection-total">{items.length.toString().padStart(2, "0")}</span></div>
            <label className="search-box"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="이름, 메모, 링크 검색" /><kbd>⌘ K</kbd></label>
          </div>

          <div className="filter-row">
            <div className="filter-list">
              {["전체", ...categories].map((category) => (
                <button key={category} className={`filter-chip ${activeCategory === category ? "filter-chip-active" : ""}`} onClick={() => setActiveCategory(category)}>{category}</button>
              ))}
            </div>
            <span className="results-label">{visibleItems.length}개의 아이템</span>
          </div>

          {error && <div role="alert" className="error-banner"><span>{error}</span><button onClick={() => void loadItems()}>다시 시도</button></div>}
          {loading ? <div className="loading-state"><LoaderCircle className="spin" size={20} /> 보관함을 열고 있어요…</div> : visibleItems.length ? (
            <div className="item-grid">
              {visibleItems.map((item, index) => (
                <article className="item-card" key={item.id} style={{ animationDelay: `${Math.min(index * 45, 300)}ms` }}>
                  <div className={`item-cover cover-${index % 5}`}>
                    {item.imageKey || item.photos?.length ? <img src={item.imageKey ? `/api/items/${item.id}/image` : item.photos?.[0]?.url} alt={`${item.title} 상품 사진`} /> : <div className="cover-placeholder"><span className="placeholder-spark">✳</span><span>{item.category}</span></div>}
                    <span className="item-category">{item.category}</span>
                    {!!item.photos?.length && <span className="photo-count">사진 {item.photos.length}장</span>}
                    <button className="delete-button" aria-label={`${item.title} 삭제`} disabled={removing === item.id} onClick={() => void removeItem(item)}>{removing === item.id ? <LoaderCircle size={16} className="spin" /> : <Trash2 size={16} />}</button>
                  </div>
                  {!!item.photos?.length && <div className="item-photo-strip">{item.photos.slice(item.imageKey ? 0 : 1, 5).map((photo) => <img key={photo.id} src={photo.url} alt="저장한 상품 사진" />)}</div>}
                  <div className="item-info">
                    <div className="item-title-row"><h2>{item.title}</h2>{item.url && <a className="open-link" href={item.url} target="_blank" rel="noreferrer" aria-label="원래 사이트에서 열기"><ArrowUpRight size={17} /></a>}</div>
                    {item.price !== null && <p className="item-price">₩{money.format(item.price)}</p>}
                    {item.sourceDescription && <p className="item-note">{item.sourceDescription}</p>}
                    {item.note && <p className="item-note user-note">{item.note}</p>}
                    <div className="item-footer"><span>{new Date(item.createdAt).toLocaleDateString("ko-KR", { year: "numeric", month: "short", day: "numeric" })}</span>{item.photos?.length ? <span className="source-label"><Check size={13} /> 사진 {item.photos.length}장 보관</span> : item.url ? <span className="source-label"><Link2 size={13} /> 링크 저장됨</span> : item.imageKey ? <span className="source-label"><Check size={13} /> 캡처 보관됨</span> : <span className="source-label">기록해 둠</span>}</div>
                  </div>
                </article>
              ))}
            </div>
          ) : items.length ? (
            <div className="empty-state filtered-empty"><div className="empty-art"><Search size={23} /></div><h2>찾는 아이템이 없어요</h2><p>다른 검색어나 카테고리를 선택해 보세요.</p><button className="text-button" onClick={() => { setQuery(""); setActiveCategory("전체"); }}>필터 지우기 <ArrowUpRight size={14} /></button></div>
          ) : (
            <div className="empty-state"><div className="empty-art"><Bookmark size={24} strokeWidth={1.5} /><span className="empty-spark">✳</span></div><p className="eyebrow">A PLACE FOR YOUR NEXT FAVORITE</p><h2>첫 번째 위시를 담아볼까요?</h2><p>링크를 붙여넣거나, 화면을 캡처해서<br className="desktop-break" /> 나중에도 찾고 싶은 아이템을 기록해 두세요.</p><button className="primary-button empty-button" onClick={() => setIsAdding(true)}><Plus size={17} /> 아이템 담기</button><div className="empty-caption"><Link2 size={14} /> 쇼핑 링크 <span>·</span> <ImagePlus size={14} /> 페이지 캡처 <span>·</span> 카테고리 분류</div></div>
          )}
          <footer className="page-footer"><span>좋아하는 마음을 천천히 모으는 곳</span><span>MOABOM <span className="footer-flower">✳</span></span></footer>
        </section>
      </div>

      {isAdding && <AddItemDialog onClose={() => setIsAdding(false)} onSaved={(item, warning) => { setItems((current) => [item, ...current]); setError(warning ?? ""); setIsAdding(false); }} />}
    </main>
  );
}

function AddItemDialog({ onClose, onSaved }: { onClose: () => void; onSaved: (item: SavedItem, warning?: string) => void }) {
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [category, setCategory] = useState<Category>("기타");
  const [price, setPrice] = useState("");
  const [sourceDescription, setSourceDescription] = useState("");
  const [note, setNote] = useState("");
  const [pagePreview, setPagePreview] = useState<ScrapedPreview | null>(null);
  const [selectedImages, setSelectedImages] = useState<string[]>([]);
  const [previewState, setPreviewState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [previewMessage, setPreviewMessage] = useState("");
  const manualFields = useRef({ title: false, category: false, price: false, description: false });
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const trimmedUrl = url.trim();
    if (!trimmedUrl) {
      setPagePreview(null); setSelectedImages([]); setPreviewState("idle"); setPreviewMessage("");
      return;
    }
    setPagePreview(null); setSelectedImages([]);
    if (!manualFields.current.title) setTitle("");
    if (!manualFields.current.category) setCategory("기타");
    if (!manualFields.current.price) setPrice("");
    if (!manualFields.current.description) setSourceDescription("");
    let controller: AbortController | undefined;
    const timer = window.setTimeout(async () => {
      controller = new AbortController();
      setPreviewState("loading"); setPreviewMessage("상품 정보와 사진을 찾고 있어요.");
      try {
        const response = await fetch("/api/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: trimmedUrl }), signal: controller.signal });
        const data = await response.json() as ScrapedPreview & { error?: string };
        if (!response.ok) throw new Error(data.error ?? "페이지를 읽지 못했어요.");
        const result = data as ScrapedPreview;
        setPagePreview(result); setSelectedImages(result.imageUrls);
        if (!manualFields.current.title) setTitle(result.title);
        if (!manualFields.current.category) setCategory(result.category);
        if (!manualFields.current.price) setPrice(result.price === null ? "" : String(result.price));
        if (!manualFields.current.description) setSourceDescription(result.description);
        setPreviewState("ready");
        setPreviewMessage(result.imageUrls.length ? `상품 정보를 채웠어요. 사진 ${result.imageUrls.length}장을 저장할게요.` : "상품 정보는 찾았지만 저장할 사진은 찾지 못했어요.");
      } catch (reason) {
        if (controller?.signal.aborted) return;
        setPagePreview(null); setSelectedImages([]); setPreviewState("error");
        setPreviewMessage(reason instanceof Error ? reason.message : "페이지를 읽지 못했어요. 상품 정보를 직접 입력해 주세요.");
      }
    }, 700);
    return () => { window.clearTimeout(timer); controller?.abort(); };
  }, [url]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0] ?? null;
    if (!selected) return;
    if (!selected.type.startsWith("image/")) { setError("이미지 파일을 선택해 주세요."); return; }
    if (selected.size > 10 * 1024 * 1024) { setError("이미지는 10MB 이하로 선택해 주세요."); return; }
    setError(""); setFile(selected); setPreview(URL.createObjectURL(selected));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError("");
    const form = new FormData();
    form.set("title", title); form.set("url", url); form.set("category", category);
    form.set("price", price); form.set("note", note); form.set("sourceDescription", sourceDescription);
    form.set("imageUrls", JSON.stringify(selectedImages));
    if (file) form.set("image", file);
    try {
      const response = await fetch("/api/items", { method: "POST", body: form });
      const data = await response.json() as { item: SavedItem; error?: string; warning?: string };
      if (!response.ok) throw new Error(data.error ?? "저장하지 못했어요.");
      onSaved(data.item, data.warning);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "저장하지 못했어요."); }
    finally { setSaving(false); }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}>
      <section className="add-dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
        <div className="dialog-heading"><div><p className="eyebrow">SAVE A LITTLE WANT</p><h2 id="dialog-title">마음에 든 걸 담아두기</h2></div><button className="icon-button" onClick={onClose} aria-label="닫기" disabled={saving}><X size={19} /></button></div>
        <form onSubmit={submit}>
          <label className="field-label" htmlFor="item-url">상품 링크 <span className="optional">붙여넣으면 자동 입력</span></label>
          <div className="input-with-icon"><Link2 size={17} /><input id="item-url" type="url" className="form-input" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https:// 마음에 든 페이지 주소" /></div>
          {!!previewMessage && <div className={`import-status import-${previewState}`} role="status">{previewState === "loading" && <LoaderCircle size={14} className="spin" />}{previewState === "ready" && <Check size={14} />}{previewState === "error" && <span className="import-warning">!</span>}<span>{previewMessage}</span></div>}

          {pagePreview?.imageUrls.length ? <div className="scraped-photos" aria-label="저장할 상품 사진 선택">{pagePreview.imageUrls.map((photoUrl, index) => <label className={`scraped-photo ${selectedImages.includes(photoUrl) ? "scraped-photo-selected" : ""}`} key={photoUrl}><img src={photoUrl} alt={`페이지에서 찾은 상품 사진 ${index + 1}`} loading="lazy" /><input type="checkbox" checked={selectedImages.includes(photoUrl)} onChange={(event) => setSelectedImages((current) => event.target.checked ? [...current, photoUrl].slice(0, 6) : current.filter((value) => value !== photoUrl))} /><span className="photo-check"><Check size={11} /></span></label>)}</div> : null}

          <label className="field-label" htmlFor="item-title">상품명 <span>*</span><span className="auto-label">자동 입력</span></label>
          <input id="item-title" className="form-input" required maxLength={160} value={title} onChange={(event) => { setTitle(event.target.value); manualFields.current.title = true; }} placeholder="예: 크림색 코튼 셔츠" />

          <div className="form-split"><div><label className="field-label" htmlFor="item-category">카테고리</label><select id="item-category" className="form-input form-select" value={category} onChange={(event) => { setCategory(event.target.value as Category); manualFields.current.category = true; }}>{categories.map((value) => <option key={value}>{value}</option>)}</select></div><div><label className="field-label" htmlFor="item-price">가격 <span className="optional">선택 · 자동 입력</span></label><div className="price-input"><span>₩</span><input id="item-price" inputMode="numeric" className="form-input" value={price} onChange={(event) => { setPrice(event.target.value.replace(/[^\d]/g, "")); manualFields.current.price = true; }} placeholder="0" /></div></div></div>

          {sourceDescription && <div className="scraped-description"><span>페이지 설명</span><p>{sourceDescription}</p></div>}

          <label className="field-label" htmlFor="item-note">메모 <span className="optional">선택</span></label>
          <textarea id="item-note" className="form-input form-textarea" rows={2} maxLength={600} value={note} onChange={(event) => setNote(event.target.value)} placeholder="색상, 사이즈, 왜 마음에 들었는지 적어두세요." />

          <div className="field-label">직접 캡처한 화면 <span className="optional">추가 사진 · 10MB 이하</span></div>
          <input ref={fileRef} type="file" accept="image/*" className="visually-hidden" onChange={chooseFile} />
          <button type="button" className={`upload-box ${preview ? "upload-box-has-file" : ""}`} onClick={() => fileRef.current?.click()}>
            {preview ? <><img src={preview} alt="선택한 캡처 미리보기" /><span className="upload-file-name">{file?.name}</span><span className="upload-change">변경</span></> : <><span className="upload-icon"><ImagePlus size={19} /></span><span><strong>화면 캡처를 올려주세요</strong><small>PNG, JPG, WEBP · 화면을 오래 보관해요</small></span><span className="upload-action">파일 선택</span></>}
          </button>
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="dialog-actions"><button type="button" className="secondary-button" onClick={onClose} disabled={saving}>취소</button><button type="submit" className="primary-button save-button" disabled={saving}>{saving ? <><LoaderCircle size={16} className="spin" /> 담는 중…</> : <><Bookmark size={16} /> 보관함에 담기</>}</button></div>
        </form>
      </section>
    </div>
  );
}
