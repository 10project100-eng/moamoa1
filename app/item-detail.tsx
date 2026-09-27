"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { ArrowUpRight, LoaderCircle, RefreshCw, X } from "lucide-react";
import type { SavedItem } from "./wishlist";

type PriceRecord = { id: string; price: number; source: string; recordedAt: string };
const money = new Intl.NumberFormat("ko-KR");
const date = (value: string) => new Date(value).toLocaleString("ko-KR", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

function PriceChart({ records }: { records: PriceRecord[] }) {
  if (!records.length) return <div className="price-empty">아직 가격 기록이 없어요.<br />최신 가격을 가져오거나 아래에서 직접 기록해 주세요.</div>;
  const prices = records.map((record) => record.price);
  const low = Math.min(...prices), high = Math.max(...prices);
  const padding = Math.max((high - low) * .2, high * .05, 1);
  const min = Math.max(0, low - padding), max = high + padding;
  const start = new Date(records[0].recordedAt).getTime();
  const end = new Date(records[records.length - 1].recordedAt).getTime();
  const points = records.map((record) => ({ ...record,
    x: end === start ? 332 : 88 + (new Date(record.recordedAt).getTime() - start) / (end - start) * 488,
    y: 176 - (record.price - min) / (max - min) * 146,
  }));
  return <figure className="price-chart">
    <svg viewBox="0 0 600 215" role="img" aria-label={`가격 기록 ${records.length}회. 최저 ${money.format(low)}원, 최고 ${money.format(high)}원.`}>
      {[0, .5, 1].map((ratio) => <g key={ratio}><line x1="88" x2="576" y1={30 + ratio * 146} y2={30 + ratio * 146} stroke="#e5ece6" strokeDasharray="4 5" /><text x="78" y={34 + ratio * 146} textAnchor="end" fill="#7f9084" fontSize="11">{money.format(Math.round(max - ratio * (max - min)))}</text></g>)}
      {points.length > 1 && <polyline points={points.map((point) => `${point.x},${point.y}`).join(" ")} fill="none" stroke="#658471" strokeWidth="2.5" strokeLinejoin="round" />}
      {points.map((point) => <circle key={point.id} cx={point.x} cy={point.y} r="4" fill="#658471" stroke="white" strokeWidth="2"><title>{date(point.recordedAt)} · ₩{money.format(point.price)}</title></circle>)}
      <text x={end === start ? 332 : 88} y="205" textAnchor={end === start ? "middle" : "start"} fill="#7f9084" fontSize="11">{new Date(records[0].recordedAt).toLocaleDateString("ko-KR")}</text>
      {end !== start && <text x="576" y="205" textAnchor="end" fill="#7f9084" fontSize="11">{new Date(records[records.length - 1].recordedAt).toLocaleDateString("ko-KR")}</text>}
    </svg>
    <figcaption>{records.length === 1 ? "첫 가격을 기록했어요. 다음 기록이 쌓이면 변화를 비교할 수 있어요." : "점은 확인한 가격이며, 점 사이의 선은 기록 간 변화를 연결합니다."}</figcaption>
  </figure>;
}

export function ItemDetailDialog({ item, onClose, onPriceChanged }: { item: SavedItem; onClose: () => void; onPriceChanged: (price: number) => void }) {
  const [records, setRecords] = useState<PriceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [manualPrice, setManualPrice] = useState("");
  const [activePhoto, setActivePhoto] = useState(0);
  const [reload, setReload] = useState(0);
  const dialog = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const photos = [...(item.imageKey ? [{ id: "capture", url: `/api/items/${item.id}/image` }] : []), ...(item.photos ?? [])];

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeRef.current();
      if (event.key !== "Tab") return;
      const elements = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), summary, [tabindex="0"]') ?? []);
      const first = elements[0], last = elements.at(-1);
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    window.addEventListener("keydown", key);
    return () => { window.removeEventListener("keydown", key); document.body.style.overflow = overflow; previous?.focus(); };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError("");
    fetch(`/api/items/${item.id}/prices`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const data = await response.json() as { history: PriceRecord[]; error?: string };
        if (!response.ok) throw new Error(data.error);
        setRecords(data.history);
      }).catch((reason) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "가격 기록을 불러오지 못했어요."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [item.id, reload]);

  async function recordPrice(mode: "crawl" | "manual") {
    if (mode === "manual" && !manualPrice.trim()) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/items/${item.id}/prices`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, ...(mode === "manual" ? { price: Number(manualPrice) } : {}) }),
      });
      const data = await response.json() as { history: PriceRecord[]; price: number; error?: string };
      if (!response.ok) throw new Error(data.error ?? "가격을 기록하지 못했어요.");
      setRecords(data.history); onPriceChanged(data.price); setManualPrice(""); setNotice("새 가격을 기록했어요.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "가격을 기록하지 못했어요."); }
    finally { setBusy(false); }
  }

  const latest = records.at(-1), first = records[0];
  const difference = latest && first ? latest.price - first.price : 0;
  function submitPrice(event: FormEvent) { event.preventDefault(); void recordPrice("manual"); }

  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="add-dialog detail-dialog" role="dialog" aria-modal="true" aria-labelledby="detail-title" tabIndex={-1} ref={dialog}>
      <div className="dialog-heading"><div><p className="eyebrow">MY SAVED ITEM</p><p className="detail-brand">{item.brand || "브랜드 미입력"}</p><h2 id="detail-title">{item.title}</h2></div><button className="icon-button" onClick={onClose} aria-label="상세 정보 닫기"><X size={19} /></button></div>
      <div className="detail-layout">
        <div className="detail-gallery">{photos.length ? <><img className="detail-main-photo" src={photos[activePhoto]?.url ?? photos[0].url} alt={`${item.title} 저장한 사진`} /><div className="detail-thumbnails">{photos.map((photo, index) => <button key={photo.id} aria-label={`사진 ${index + 1} 보기`} aria-pressed={activePhoto === index} onClick={() => setActivePhoto(index)}><img src={photo.url} alt="" /></button>)}</div></> : <div className="detail-no-photo"><span>✳</span>저장한 사진이 없어요</div>}</div>
        <div className="detail-copy"><span className="detail-category">{item.category}</span><p className="detail-price">{item.price !== null ? `₩${money.format(item.price)}` : "가격 미입력"}</p><p className="detail-date">{latest ? `마지막 가격 기록 ${date(latest.recordedAt)}` : `보관한 날 ${date(item.createdAt)}`}</p><h3>제품 설명</h3><p>{item.sourceDescription || "등록한 설명이 없어요."}</p><h3>내 메모</h3><p>{item.note || "등록한 메모가 없어요."}</p>{item.url && <a className="secondary-button original-link" href={item.url} target="_blank" rel="noopener noreferrer">원래 상품 페이지 열기 <ArrowUpRight size={15} /></a>}</div>
      </div>
      <section className="price-section" aria-labelledby="price-heading"><div className="price-heading"><div><p className="eyebrow">PRICE HISTORY</p><h3 id="price-heading">가격 변동</h3></div><button className="secondary-button" disabled={busy || loading || !item.url} onClick={() => void recordPrice("crawl")}>{busy ? <LoaderCircle size={14} className="spin" /> : <RefreshCw size={14} />} 최신 가격 가져오기</button></div>
        <p className="price-help">저장한 가격과 여기서 새로 가져오거나 직접 입력한 원화 가격을 기록해요. 저장하기 전의 가격 이력은 제공하지 않아요.</p>
        {loading ? <p className="price-empty"><LoaderCircle size={18} className="spin" /> 가격 기록을 불러오는 중…</p> : <>
          {records.length > 0 && <div className="price-stats"><div><span>최저 기록</span><strong>₩{money.format(Math.min(...records.map((record) => record.price)))}</strong></div><div><span>처음 기록 대비</span><strong className={difference < 0 ? "price-down" : ""}>{records.length < 2 ? "비교할 기록 대기" : difference === 0 ? "변동 없음" : `${difference > 0 ? "+" : "−"}₩${money.format(Math.abs(difference))}`}</strong></div><div><span>기록 횟수</span><strong>{records.length}회</strong></div></div>}
          <PriceChart records={records} />
        </>}
        {error && <div className="form-error" role="alert">{error} <button className="text-button" disabled={busy || loading} onClick={() => setReload((value) => value + 1)}>기록 다시 불러오기</button></div>}
        {notice && <p className="price-notice" role="status">{notice}</p>}
        <form className="price-form" onSubmit={submitPrice}><label htmlFor="record-price">확인한 가격 직접 기록 <span>크롤링이 안 될 때도 입력할 수 있어요.</span></label><div><div className="price-input"><span>₩</span><input id="record-price" className="form-input" inputMode="numeric" required value={manualPrice} onChange={(event) => setManualPrice(event.target.value.replace(/[^\d]/g, ""))} placeholder="확인한 원화 가격" /></div><button className="primary-button" disabled={busy || loading || !manualPrice}>가격 기록</button></div></form>
        {!!records.length && <details className="price-records"><summary>가격 기록 전체 보기 ({records.length})</summary><div className="price-table"><table><thead><tr><th scope="col">기록 시각</th><th scope="col">가격</th><th scope="col">출처</th></tr></thead><tbody>{[...records].reverse().map((record) => <tr key={record.id}><td>{date(record.recordedAt)}</td><td>₩{money.format(record.price)}</td><td>{record.source === "crawl" ? "사이트에서 확인" : record.source === "saved" ? "기존 저장 가격" : "직접 입력"}</td></tr>)}</tbody></table></div></details>}
      </section>
    </section>
  </div>;
}
