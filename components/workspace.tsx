"use client";

import { GlassLayers } from "./liquid-glass-effects";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, BookOpen, Check, ChevronLeft, ChevronRight, Download, Edit3, File, Film, Heart, ImageIcon, ImagePlus, LoaderCircle, Music2, Pause, Play, Plus, Search, SlidersHorizontal, Sparkles, Trash2, Upload } from "lucide-react";
import { entryKinds, kindLabels, type Asset, type Entry, type EntryData, type EntryKind, type SiteSettings } from "@/lib/types";
import { EntryEditor } from "./entry-editor";
import { CollectionStage } from "./collection-stage";
import { MediaPlayer } from "./media-player";
import { MediaImporter } from "./media-importer";
import { musicEntryUpdatedEvent, useMusicLibrary } from "./music-library";
import { CalendarView, JourneyView, MemoryBookPreview, StarMapView } from "./special-views";
import { SettingsPanel } from "./settings-panel";
import { Modal, downloadBlob, errorMessage, request, selectedBackup } from "./client-utils";
import { MotionList, MotionPresence, MotionSwap, SharedArtwork, useMotionPreference } from "./motion";

const titles: Record<string, [string, string, string]> = {
  music: ["THE SOUND COLLECTION", "音乐馆", "留一首常听的歌，也留一段听歌时的心情。"],
  albums: ["ALBUM ARCHIVE", "专辑馆", "沿着作品的年份，重温每一段旋律。"],
  videos: ["ON STAGE", "影像馆", "那些想再看一次的舞台，收藏在这里。"],
  photos: ["IN THE LIGHT", "照片馆", "用一帧现场，记住光落下的瞬间。"],
  journey: ["MY JOURNEY · SINCE 2009", "我的十余年星途。", "从 2009 年的初次喜欢，到今天依然明亮的热爱。"],
  timeline: ["THROUGH THE YEARS", "时光长廊", "将作品、现场与生活，按时间慢慢展开。"],
  concerts: ["LIVE MEMORIES", "演唱会回忆", "票根、场馆与心情，把那一晚好好留下。"],
  letters: ["LETTERS TO JASON", "写给张杰的信", "有些话，适合慢慢写。"],
  journal: ["THE QUIET PAGES", "追星日记", "在熟悉的旋律旁，记下自己的生活。"],
  milestones: ["DAYS TO REMEMBER", "纪念日", "认真记住一段开始，也记住每一次回望。"],
  "memory-book": ["A BOOK OF MEMORIES", "十余年纪念册", "选定、排序、装订，把回忆留在纸上。"],
  calendar: ["DAYS IN THE ARCHIVE", "纪念日历", "将值得记住的日子，轻轻圈起来。"],
  search: ["FIND YOUR MOMENT", "搜索珍藏", "从标题、文字与标签，找回熟悉的片段。"],
  archive: ["THE COMPLETE COLLECTION", "综合典藏馆", "作品、照片、文字与素材，都在这里。"],
  "star-map": ["MY CONSTELLATION", "我的追星星系", "选一份珍藏，点亮一个坐标。"],
  admin: ["THE COLLECTION DESK", "内容管理", "整理记录，照料每一份珍藏。"],
  settings: ["MAKE IT YOURS", "网站设置", "名字、照片和一点点偏好。"],
};
const iconFor = (kind: EntryKind) => kind === "music" ? <Music2 size={25} /> : kind === "videos" ? <Film size={25} /> : kind === "photos" ? <ImageIcon size={25} /> : <BookOpen size={25} />;
function entryDate(entry: Entry) { return entry.data.date || (entry.data.year ? `${entry.data.year} 年` : "日期未记录"); }
function routeFor(entry: Entry) { return `/app/${entry.kind}/${entry.id}`; }

function EntryDetail({ entry, entries, assets, onEdit, onDelete, onFavorite, onOpen, onBook, sharedArtwork = false, readOnly = false }: { entry: Entry; entries: Entry[]; assets: Asset[]; onEdit: () => void; onDelete: () => void; onFavorite: () => void; onOpen: (entry: Entry) => void; onBook: () => void; sharedArtwork?: boolean; readOnly?: boolean }) {
  const paper = entry.kind === "letters" || entry.kind === "journal";
  const relatedIds = [...new Set([...(entry.data.relatedIds || []), ...(entry.data.albumId ? [entry.data.albumId] : [])])];
  const related = relatedIds.map(id => entries.find(item => item.id === id)).filter((item): item is Entry => !!item);
  const cover = assets.find(item => item.id === entry.data.coverAssetId);
  const coverImage = cover ? <img className="ws-detail-cover" src={`/api/assets/${cover.id}`} alt={`${entry.title}封面`} /> : null;
  return <article className={`ws-detail ${paper ? "ws-detail-paper" : ""}`}>{paper && <GlassLayers />}
    <header><span className="ws-eyebrow">{kindLabels[entry.kind]} · {entryDate(entry)}{entry.data.status === "draft" ? " · 草稿" : ""}</span><h1>{entry.title}</h1><div className="ws-detail-meta">{entry.data.artist && <span>{entry.data.artist}</span>}{entry.data.category && <span>{entry.data.category}</span>}{entry.data.city && <span>{entry.data.city} · {entry.data.venue}</span>}{entry.data.mood && <span>心情：{entry.data.mood}</span>}{["timeline", "journey"].includes(entry.kind) && <span className="ws-verification-badge">{entry.data.category === "个人记忆" || entry.data.category === "生活片段" ? "个人回忆" : entry.data.verified ? "资料已核实" : "资料待核实"}</span>}</div></header>
    <div className="ws-actions ws-detail-actions">{!readOnly && <><button className="ws-button ws-button-secondary" onClick={onEdit}><Edit3 size={15} />编辑记录</button><button className={`ws-button ws-button-ghost ${entry.favorite ? "is-favorite" : ""}`} onClick={onFavorite}><Heart size={15} fill={entry.favorite ? "currentColor" : "none"} />{entry.favorite ? "取消收藏" : "加入收藏"}</button></>}{entry.kind === "memory-book" && <button className="ws-button" onClick={onBook}><BookOpen size={15} />预览 / 导出纪念册</button>}{!readOnly && <button className="ws-button ws-button-ghost ws-danger-text" onClick={onDelete}><Trash2 size={15} />删除</button>}</div>
    {["music", "videos", "photos"].includes(entry.kind) && <MediaPlayer key={`${entry.id}-${entry.data.assetId || ""}-${entry.data.coverAssetId || ""}-${entry.data.externalUrl || ""}-${entry.data.sourceType || ""}`} entry={entry} assets={assets} sharedArtwork={sharedArtwork} />}
    {cover && !["music", "videos", "photos"].includes(entry.kind) && (sharedArtwork ? <SharedArtwork name={`entry-image-${entry.id}`}>{coverImage}</SharedArtwork> : coverImage)}
    {entry.data.description && <div className="ws-detail-body">{entry.data.description}</div>}
    {entry.data.notes && <aside className="ws-detail-notes"><span>我的私人笔记</span><p>{entry.data.notes}</p></aside>}
    {entry.data.tags?.length ? <div className="ws-tags">{entry.data.tags.map(tag => <span key={tag}>{tag}</span>)}</div> : null}
    {entry.kind === "memory-book" && <div className="ws-note"><p>这本纪念册亲自选定了 {entry.data.itemIds?.length || 0} 份记录。只有这些选定的内容会进入预览与打印。</p><button className="ws-link-button" onClick={onBook}>打开纸张预览 <ArrowRight size={14} /></button></div>}
    {related.length > 0 && <section className="ws-related"><h3>同一条星轨上的珍藏</h3>{related.map(item => <button className="ws-agenda-item" key={item.id} onClick={() => onOpen(item)}><span>{kindLabels[item.kind]}</span><strong>{item.title}</strong><ChevronRight size={16} /></button>)}</section>}
    <footer className="ws-detail-footer">最近保存：{new Date(entry.updatedAt).toLocaleString("zh-CN")}</footer>
  </article>;
}

function PhotoLightbox({ photos, index: initialIndex, onClose }: { photos: Entry[]; index: number; onClose: () => void }) {
  const [index, setIndex] = useState(initialIndex); const [error, setError] = useState("");
  const current = photos[index];
  function next(step: number) { setIndex(currentIndex => (currentIndex + step + photos.length) % photos.length); setError(""); }
  useEffect(() => { function key(event: KeyboardEvent) { if (event.key === "ArrowRight") { event.preventDefault(); setIndex(currentIndex => (currentIndex + 1) % photos.length); setError(""); } if (event.key === "ArrowLeft") { event.preventDefault(); setIndex(currentIndex => (currentIndex - 1 + photos.length) % photos.length); setError(""); } } document.addEventListener("keydown", key); return () => document.removeEventListener("keydown", key); }, [photos.length]);
  if (!current) return null;
  return <Modal title={`照片灯箱 · ${index + 1} / ${photos.length}`} onClose={onClose} wide><div className="ws-lightbox"><button className="ws-icon-button" aria-label="上一张照片" onClick={() => next(-1)} disabled={photos.length < 2}><ChevronLeft size={24} /></button><MotionSwap motionKey={current.id} className="ws-lightbox-frame"><figure>{current.data.assetId && <img key={current.id} src={`/api/assets/${current.data.assetId}`} alt={current.title} onError={() => setError("这张照片的原始文件无法读取。")} />}<figcaption><h3>{current.title}</h3><p>{current.data.description}</p></figcaption><MotionPresence show={!!error}><p className="ws-error" role="alert">{error}</p></MotionPresence></figure></MotionSwap><button className="ws-icon-button" aria-label="下一张照片" onClick={() => next(1)} disabled={photos.length < 2}><ChevronRight size={24} /></button></div><p className="ws-tiny ws-center">使用 ← → 切换 · Esc 关闭</p></Modal>;
}

export function Workspace({ kind, initialEntries, initialAssets, settings: initialSettings, detailId, themeMediaAvailable = false, readOnly = false }: { kind: string; initialEntries: Entry[]; initialAssets: Asset[]; settings: SiteSettings; detailId?: string; themeMediaAvailable?: boolean; readOnly?: boolean }) {
  const router = useRouter();
  const music = useMusicLibrary();
  const syncMusicLibrary = music?.updateLibrary;
  const animated = useMotionPreference();
  const itemMotion = { layout: animated ? "position" as const : false, initial: animated ? { opacity: 0, y: 12 } : false as const, animate: { opacity: 1, y: 0, scale: 1 }, exit: { opacity: 0, y: animated ? -8 : 0, scale: animated ? .985 : 1 }, transition: { duration: animated ? .28 : 0, ease: [.22, 1, .36, 1] as [number, number, number, number] } };
  const [entries, setEntries] = useState(initialEntries); const [assets, setAssets] = useState(initialAssets); const [settings, setSettings] = useState(initialSettings);
  const [importKind, setImportKind] = useState<"music" | "videos" | "photos" | null>(null);
  const [importTarget, setImportTarget] = useState<Entry | undefined>();
  useEffect(() => { syncMusicLibrary?.(entries, assets); }, [entries, assets, syncMusicLibrary]);
  const categoryKind = kind.startsWith("admin/") && kind !== "admin/memories" ? kind.slice(6) : kind;
  const regularKind = entryKinds.includes(categoryKind as EntryKind) ? categoryKind as EntryKind : undefined;
  const [query, setQuery] = useState(""); const [favorites, setFavorites] = useState(false); const [year, setYear] = useState(""); const [category, setCategory] = useState(""); const [typeFilter, setTypeFilter] = useState("all"); const [sort, setSort] = useState("updated"); const [page, setPage] = useState(1); const [selected, setSelected] = useState<string[]>([]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [manageMode, setManageMode] = useState(false);
  const [editor, setEditor] = useState<{ kind: EntryKind; entry?: Entry; initialData?: EntryData } | null>(null); const [detail, setDetail] = useState<Entry | null>(null); const [deleteIds, setDeleteIds] = useState<string[]>([]); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [message, setMessage] = useState("");
  const [lightbox, setLightbox] = useState<number | null>(null); const [book, setBook] = useState<Entry | null>(null); const [archiveTab, setArchiveTab] = useState("records");
  useEffect(() => {
    function syncLyrics(event: Event) {
      const entry = (event as CustomEvent<Entry>).detail;
      setEntries(current => current.map(item => item.id === entry.id ? entry : item));
      setDetail(current => current?.id === entry.id ? entry : current);
      setEditor(current => current?.entry?.id === entry.id ? {...current, entry} : current);
    }
    window.addEventListener(musicEntryUpdatedEvent, syncLyrics);
    return () => window.removeEventListener(musicEntryUpdatedEvent, syncLyrics);
  }, []);
  const [deleteAsset, setDeleteAsset] = useState<Asset | null>(null);
  const fixedDetail = detailId ? entries.find(entry => entry.id === detailId) : undefined;
  const headers = (categoryKind === "journey" ? ["MY JOURNEY", "我的星途", settings.startYear ? "从 " + settings.startYear + " 年开始，把热爱慢慢写成故事。" : "从初次喜欢开始，把热爱慢慢写成故事。"] : titles[categoryKind]) || (kind === "admin/memories" ? ["MEMORY MANAGEMENT", "回忆管理", "整理年份章节、现场与文字。"] : titles.archive);
  const kindEntries = useMemo(() => entries.filter(entry => regularKind ? entry.kind === regularKind : kind === "admin/memories" ? ["journey", "timeline", "concerts", "journal", "letters", "milestones", "memory-book"].includes(entry.kind) : true), [entries, regularKind, kind]);
  const availableYears = [...new Set(kindEntries.map(entry => entry.data.year || (entry.data.date ? Number(entry.data.date.slice(0, 4)) : undefined)).filter((value): value is number => !!value))].sort((a, b) => b - a);
  const categories = [...new Set(kindEntries.map(entry => entry.data.category).filter((value): value is string => !!value))];
  const filtered = useMemo(() => kindEntries.filter(entry => {
    const haystack = `${entry.title} ${entry.data.description || ""} ${entry.data.notes || ""} ${entry.data.tags?.join(" ") || ""} ${entry.data.artist || ""} ${entry.data.year || ""}`.toLowerCase();
    return (!query || haystack.includes(query.toLowerCase())) && (!favorites || entry.favorite) && (!year || String(entry.data.year || entry.data.date?.slice(0, 4)) === year) && (!category || entry.data.category === category) && (typeFilter === "all" || entry.kind === typeFilter);
  }).sort((a, b) => sort === "title" ? a.title.localeCompare(b.title, "zh-CN") : sort === "date" ? String(b.data.date || b.data.year || "").localeCompare(String(a.data.date || a.data.year || "")) : sort === "favorite" ? Number(b.favorite) - Number(a.favorite) || b.updatedAt.localeCompare(a.updatedAt) : sort === "oldest" ? a.createdAt.localeCompare(b.createdAt) : b.updatedAt.localeCompare(a.updatedAt)), [kindEntries, query, favorites, year, category, typeFilter, sort]);
  const pageSize = 12; const maxPage = Math.max(1, Math.ceil(filtered.length / pageSize)); const currentPage = Math.min(page, maxPage); const displayed = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const photos = filtered.filter(entry => entry.kind === "photos" && entry.data.assetId);
  function resetPage() { setPage(1); }
  function onAsset(asset: Asset) { setAssets(current => [...current.filter(item => item.id !== asset.id), asset]); }
  function onSaved(entry: Entry) {
    // A new upload belongs on the first page, including when a previous filter excludes it.
    if (!entries.some(item => item.id === entry.id)) {
      setQuery(""); setFavorites(false); setYear(""); setCategory(""); setTypeFilter("all"); setSort("updated"); setPage(1);
    }
    setEntries(current => [...current.filter(item => item.id !== entry.id), entry]);
    setDetail(current => current?.id === entry.id ? entry : current); setEditor(null); setImportKind(null);
    setMessage(entry.kind === "photos" ? "照片已保存，可以点击图片放大查看。" : "这份记录已妥善保存。"); router.refresh();
  }
  function createRecord(entryKind: EntryKind) { if (entryKind === "photos") importMedia("photos"); else setEditor({kind: entryKind}); }
  function open(entry: Entry) { setDetail(entry); }
  function openListEntry(entry: Entry) {
    if (entry.kind === "music" && music) music.select(entry.id, true);
    else open(entry);
  }
  function importMedia(mediaKind: "music" | "videos" | "photos", target?: Entry) { if (mediaKind === "music" && target) music?.select(target.id); setImportTarget(target); setImportKind(mediaKind); }
  async function favorite(entry: Entry) {
    setError("");
    try { const result = await request<{ entry: Entry }>(`/api/entries/${entry.id}`, { method: "PATCH", body: JSON.stringify({ favorite: !entry.favorite }) }); setEntries(current => current.map(item => item.id === entry.id ? result.entry : item)); setDetail(current => current?.id === entry.id ? result.entry : current); }
    catch (failure) { setError(errorMessage(failure)); }
  }
  async function removeEntries() {
    setBusy(true); setError(""); let removed = 0; const removedIds: string[] = [];
    try {
      for (const id of deleteIds) { await request(`/api/entries/${id}`, { method: "DELETE" }); setEntries(current => current.filter(entry => entry.id !== id)); setSelected(current => current.filter(item => item !== id)); setDetail(current => current?.id === id ? null : current); removed++; removedIds.push(id); }
      setDeleteIds([]); setMessage(`已删除 ${removed} 份记录。媒体原始文件仍保留在私人素材库。`); if (detailId && deleteIds.includes(detailId)) router.push(`/app/${categoryKind}`); router.refresh();
    } catch (failure) { setError(`${removed ? `已删除 ${removed} 份。` : ""}${errorMessage(failure)}`); setDeleteIds(current => current.filter(id => !removedIds.includes(id))); } finally { setBusy(false); }
  }
  async function exportSelected() {
    setBusy(true); setError("");
    try { const full = await request<{ entries: Entry[]; assets: Asset[]; settings: SiteSettings; [key: string]: unknown }>("/api/backup"); const backup = selectedBackup(full, selected); downloadBlob(new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" }), "星途-所选记录.json"); setMessage(`${backup.entries.length} 份所选记录及其引用的素材元信息已生成下载文件，不包含媒体原始文件与其他私人内容。`); }
    catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); }
  }
  async function removeAsset() {
    if (!deleteAsset) return; setBusy(true); setError("");
    try { await request(`/api/assets/${deleteAsset.id}`, { method: "DELETE" }); setAssets(current => current.filter(asset => asset.id !== deleteAsset.id)); setDeleteAsset(null); setMessage("未被引用的素材文件已删除。"); router.refresh(); }
    catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); }
  }
  const countFor = (entryKind: EntryKind) => entries.filter(entry => entry.kind === entryKind).length;
  const canList = !["settings", "calendar", "star-map", "journey", "admin"].includes(categoryKind);
  return <div className={`workspace archive-workspace workspace-${categoryKind.replaceAll("/", "-")} ${readOnly ? "workspace-readonly" : ""}`}>
    {!detailId && <header className="ws-page-heading"><div><span className="ws-eyebrow">{categoryKind === "journey" ? `MY JOURNEY · SINCE ${settings.startYear || "…"}` : headers[0]}</span><h1>{headers[1]}</h1><p>{headers[2]}</p></div><div className="ws-heading-actions">{canList && <p className="ws-collection-total"><strong>{String(kindEntries.length).padStart(2, "0")}</strong><span>{categoryKind === "music" ? "首歌曲" : categoryKind === "albums" ? "张专辑" : "份珍藏"}</span></p>}{regularKind && !readOnly && <div className="library-media-actions">{["music", "videos", "photos"].includes(regularKind) && <button className="ws-button" onClick={() => importMedia(regularKind as "music" | "videos" | "photos")}>{regularKind === "photos" ? <ImagePlus size={17} /> : <Upload size={17} />}{regularKind === "music" ? "上传歌曲" : regularKind === "videos" ? "上传演唱会视频" : "添加照片"}</button>}<button className={`ws-button ${["music", "videos", "photos"].includes(regularKind) ? "ws-button-secondary" : ""}`} onClick={() => regularKind === "photos" ? setEditor({kind: "photos"}) : createRecord(regularKind)} data-testid="entry-create"><Plus size={17} />{regularKind === "photos" ? "从素材库添加" : "添加记录"}</button></div>}</div></header>}
    {!detailId && categoryKind === "music" && <div className="library-ready-summary"><p>{music?.externalTracks?.length ? `${music.tracks.length} 首本地歌曲 · ${music.externalTracks.length} 首网易云歌曲` : music?.tracks.length ? `${music.tracks.length} 首本地歌曲可以直接播放，换个页面也能继续听。` : "上传歌曲，或添加网易云歌曲链接，就能在这里听。"}</p>{!!(music?.tracks.length || music?.externalTracks?.length) && <button className="ws-button ws-button-secondary" onClick={() => {const first = music?.tracks[0] || music?.externalTracks?.[0]; if (first) music?.play(first.entry.id);}}><Play size={15} />{music?.tracks.length ? "播放本地歌曲" : "网易云播放"}</button>}</div>}
    <MotionPresence show={!!error}><p className="ws-error" role="alert">{error}</p></MotionPresence><MotionPresence show={!!message}><p className="ws-success" role="status"><Check size={15} />{message}<button className="ws-link-button" aria-label="关闭成功消息" onClick={() => setMessage("")}>关闭</button></p></MotionPresence>
    {detailId ? <><Link href={`/app/${categoryKind}`} className="ws-back"><ArrowLeft size={15} />返回{kindLabels[categoryKind as EntryKind] || "典藏馆"}</Link>{fixedDetail ? <EntryDetail readOnly={readOnly} sharedArtwork entry={fixedDetail} entries={entries} assets={assets} onEdit={() => setEditor({ kind: fixedDetail.kind, entry: fixedDetail })} onDelete={() => setDeleteIds([fixedDetail.id])} onFavorite={() => void favorite(fixedDetail)} onOpen={open} onBook={() => setBook(fixedDetail)} /> : <div className="ws-empty"><GlassLayers /><h2>这份记录已不在这里。</h2><p>它可能已被删除，或你没有访问权限。</p></div>}</> : <>
      {categoryKind === "settings" && <SettingsPanel initialSettings={settings} entries={entries} assets={assets} themeMediaAvailable={themeMediaAvailable} onAsset={onAsset} onSaved={value => { setSettings(value); router.refresh(); }} />}
      {categoryKind === "calendar" && <CalendarView entries={entries} settings={settings} onOpen={open} onCreate={readOnly ? () => {} : () => setEditor({ kind: "milestones" })} />}
      {categoryKind === "journey" && <JourneyView entries={entries} settings={settings} onOpen={open} onCreate={readOnly ? () => {} : year => setEditor({ kind: "journey", initialData: year ? { year, date: String(year), datePrecision: "year" } : undefined })} />}
      {categoryKind === "star-map" && <StarMapView entries={entries} onOpen={open} />}
      {categoryKind === "admin" && <><div className="ws-admin-counts">{entryKinds.map(entryKind => <Link key={entryKind} href={`/app/${entryKind}`}><GlassLayers /><span>{kindLabels[entryKind]}</span><strong>{countFor(entryKind)}</strong><ArrowRight size={16} /></Link>)}</div><div className="ws-admin-columns"><section><h2>最近留存的记录</h2>{entries.length ? [...entries].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 8).map(entry => <button key={entry.id} className="ws-agenda-item" onClick={() => open(entry)}><span>{kindLabels[entry.kind]}</span><strong>{entry.title}</strong><ChevronRight size={16} /></button>) : <div className="ws-note"><p>还没有记录</p></div>}</section><section><h2>从这里开始整理</h2><div className="ws-quick-create">{entryKinds.map(entryKind => <button className="ws-button ws-button-secondary" key={entryKind} onClick={() => createRecord(entryKind)}><Plus size={15} />{kindLabels[entryKind]}</button>)}</div><div className="ws-note"><p>素材文件：{assets.length} 份 · 内容记录：{entries.length} 份</p><Link href="/app/archive">整理照片、歌曲与视频 <ArrowRight size={14} /></Link></div><Link href="/app/settings" className="ws-button ws-button-ghost"><SlidersHorizontal size={16} />网站设置与备份</Link></section></div></>}
      {canList && <>
        {categoryKind === "archive" && <div className="ws-tabs" role="tablist" aria-label="典藏馆视图"><button role="tab" aria-selected={archiveTab === "records"} onClick={() => setArchiveTab("records")}>全部记录 <span>{entries.length}</span></button><button role="tab" aria-selected={archiveTab === "assets"} onClick={() => setArchiveTab("assets")}>素材文件 <span>{assets.length}</span></button></div>}
        <MotionSwap motionKey={archiveTab === "assets" && categoryKind === "archive" ? "assets" : "records"}>{archiveTab === "assets" && categoryKind === "archive" ? <><p className="ws-tiny">{readOnly ? "这里仅列出已公开精选关联的媒体文件。" : "素材文件与内容记录分开保存。仍被记录或首页引用的文件不能删除。"}</p><MotionList className="ws-assets-list">{assets.length ? assets.map(asset => <motion.article key={asset.id} data-motion-managed {...itemMotion}>{asset.mediaType === "image" ? <img src={`/api/assets/${asset.id}`} alt={asset.filename} loading="lazy" /> : <div className="ws-asset-placeholder">{asset.mediaType === "audio" ? <Music2 size={25} /> : <Film size={25} />}</div>}<div><h3>{asset.filename}</h3><p>{(asset.size / 1024 / 1024).toFixed(2)} MB · {asset.mimeType}</p></div>{!readOnly && <div className="ws-actions"><button className="ws-icon-button ws-danger-text" aria-label={`删除素材${asset.filename}`} onClick={() => setDeleteAsset(asset)}><Trash2 size={17} /></button></div>}</motion.article>) : <motion.div key="empty-assets" className="ws-empty" data-motion-managed {...itemMotion}><GlassLayers /><File size={28} /><h2>{readOnly ? "还没有公开的素材。" : "素材库，还是一张空白纸。"}</h2><p>{readOnly ? "所有者公开精选后，关联的照片、歌曲和视频会出现在这里。" : "在音乐馆、影像馆或照片馆新增记录，上传照片、歌曲或视频。"}</p>{!readOnly && <Link className="ws-button ws-button-secondary" href="/app/photos">去照片馆添加</Link>}</motion.div>}</MotionList></> : <>
        <MotionPresence show={kindEntries.length > 0 && (categoryKind === "music" || categoryKind === "albums" && !query && !favorites && !year && !category && typeFilter === "all")} preset="panel"><CollectionStage kind={categoryKind} entries={kindEntries} assets={assets} onOpen={open} onAddAudio={entry => importMedia("music", entry)} readOnly={readOnly} /></MotionPresence>
        <div className="ws-toolbar ws-library-toolbar">
          <div className="ws-search-input"><Search size={17} /><input aria-label="搜索记录" value={query} onChange={event => { setQuery(event.target.value); resetPage(); }} placeholder="找一首歌、一段回忆" /></div>
          {!readOnly && <button className={`ws-filter-button ${favorites ? "is-active" : ""}`} aria-pressed={favorites} onClick={() => { setFavorites(!favorites); resetPage(); }}><Heart size={16} fill={favorites ? "currentColor" : "none"} />只看收藏</button>}
          <button className={`ws-filter-button ${filtersOpen ? "is-active" : ""}`} aria-expanded={filtersOpen} aria-controls="collection-filters" onClick={() => setFiltersOpen(!filtersOpen)}><SlidersHorizontal size={16} />筛选</button>
        </div>
        <MotionPresence show={filtersOpen} className="ws-filter-presence" preset="panel"><div id="collection-filters" className="ws-filter-panel"><GlassLayers />
          {!regularKind && <label className="ws-field">类型<select aria-label="筛选记录类型" value={typeFilter} onChange={event => { setTypeFilter(event.target.value); resetPage(); }}><option value="all">所有类型</option>{entryKinds.map(entryKind => <option key={entryKind} value={entryKind}>{kindLabels[entryKind]}</option>)}</select></label>}
          <label className="ws-field">年份<select value={year} onChange={event => { setYear(event.target.value); resetPage(); }} aria-label="年份筛选"><option value="">所有年份</option>{availableYears.map(value => <option key={value}>{value}</option>)}</select></label>
          {categories.length > 0 && <label className="ws-field">分类<select value={category} onChange={event => { setCategory(event.target.value); resetPage(); }} aria-label="分类筛选"><option value="">所有分类</option>{categories.map(value => <option key={value}>{value}</option>)}</select></label>}
          <label className="ws-field">排列<select aria-label="排序方式" value={sort} onChange={event => { setSort(event.target.value); resetPage(); }}><option value="updated">最近更新</option><option value="oldest">最早记录</option><option value="date">记录日期</option><option value="title">标题排序</option>{!readOnly && <option value="favorite">收藏优先</option>}</select></label>
          <button className="ws-link-button" onClick={() => {setYear("");setCategory("");setTypeFilter("all");setSort("updated");resetPage();}}>重置筛选</button>
        </div></MotionPresence>
        <div className="ws-list-summary"><span>{query ? `找到 ${filtered.length} 份记忆` : `共 ${filtered.length} 份珍藏`}</span><div className="ws-list-tools">{!readOnly && manageMode && displayed.length > 0 && <label className="ws-check"><input type="checkbox" checked={displayed.every(entry => selected.includes(entry.id))} onChange={event => setSelected(event.target.checked ? [...new Set([...selected, ...displayed.map(entry => entry.id)])] : selected.filter(id => !displayed.some(entry => entry.id === id)))} />选择本页</label>}{!readOnly && <><button className="ws-link-button" aria-pressed={manageMode} onClick={() => {setManageMode(!manageMode);setSelected([]);}}>{manageMode ? "完成管理" : "管理记录"}</button>{!regularKind && <button className="ws-link-button" onClick={() => createRecord(typeFilter === "all" ? "journal" : typeFilter as EntryKind)}><Plus size={14} />添加记录</button>}</>}</div></div>
        {!readOnly && <MotionPresence show={selected.length > 0} className="ws-bulk-bar"><GlassLayers /><span>已选择 {selected.length} 份记录</span><button className="ws-button ws-button-ghost" disabled={busy} onClick={() => void exportSelected()}><Download size={15} />导出所选</button><button className="ws-button ws-button-ghost ws-danger-text" onClick={() => setDeleteIds(selected)} disabled={busy}><Trash2 size={15} />删除所选</button><button className="ws-link-button" onClick={() => setSelected([])}>清空选择</button></MotionPresence>}
        <MotionSwap motionKey={filtered.length ? "records" : "empty"}>{!filtered.length ? <div className="ws-empty"><GlassLayers /><Sparkles size={30} /><span className="ws-eyebrow">A SPACE FOR YOUR MEMORIES</span><h2>{query || favorites || year || category ? "还没有找到这份记忆。" : readOnly ? "这里还没有公开精选。" : "给这一页，留一份珍藏。"}</h2><p>{query || favorites || year || category ? "试试其他关键词，或取消筛选。" : readOnly ? "所有者选中的公开记录会显示在这里。" : "从一首常听的歌、一张珍藏的照片，或一段想留下的心情开始。"}</p>{!readOnly && (regularKind ? <button className="ws-button ws-button-secondary" onClick={() => createRecord(regularKind)}><Plus size={16} />{regularKind === "photos" ? "添加第一张照片" : "添加第一份记录"}</button> : <Link href="/app/journal" className="ws-button ws-button-secondary">从一页日记开始</Link>)}</div> : <>
        <MotionList glass={categoryKind === "music"} className={`ws-entry-grid ${categoryKind === "music" ? "ws-music-grid" : categoryKind === "albums" ? "ws-album-grid" : categoryKind === "videos" ? "ws-video-grid" : ""} ${categoryKind === "photos" ? "ws-photo-grid" : ""} ${["letters", "journal"].includes(categoryKind) ? "ws-writing-grid" : ""} ${categoryKind === "timeline" ? "ws-timeline-grid" : ""}`}>{displayed.map((entry, index) => {
          const imageId = entry.kind === "photos" ? entry.data.assetId : entry.data.coverAssetId; const image = assets.find(asset => asset.id === imageId && asset.mediaType === "image"); const isPhoto = entry.kind === "photos"; const external = music?.externalTracks?.some(track => track.entry.id === entry.id); const playable = entry.kind === "music" && (music?.tracks.some(track => track.entry.id === entry.id) || external); const active = music?.current?.entry.id === entry.id && music.playing;
          return <motion.article className={`ws-entry-card ${manageMode ? "is-managing" : ""}`} data-kind={entry.kind} data-selected={entry.kind === "music" ? music?.selectedId === entry.id : undefined} key={entry.id} data-testid="entry-card" data-motion-managed {...itemMotion} whileHover={animated ? { y: -3 } : undefined} onClick={event => {
            if (entry.kind !== "music" || manageMode || !(event.target instanceof Element) || event.target.closest("button,a,input,select,textarea,label")) return;
            openListEntry(entry);
          }}>
            {!["music", "albums", "photos"].includes(categoryKind) && <GlassLayers />}
            {!readOnly && <MotionPresence show={manageMode} className="ws-card-select"><input type="checkbox" aria-label={`选择${entry.title}`} checked={selected.includes(entry.id)} onChange={event => setSelected(event.target.checked ? [...selected, entry.id] : selected.filter(id => id !== entry.id))} /></MotionPresence>}
            {!["letters", "journal", "milestones"].includes(entry.kind) && (!readOnly || !isPhoto || Boolean(image)) && <button className={`ws-card-image ${image ? "has-image" : ""}`} onClick={() => isPhoto ? image ? setLightbox(photos.findIndex(photo => photo.id === entry.id)) : importMedia("photos", entry) : openListEntry(entry)} aria-label={isPhoto ? image ? `在灯箱查看${entry.title}` : `添加${entry.title}的照片文件` : entry.kind === "music" ? `选择${entry.title}` : `查看${entry.title}`}>
              {image ? <SharedArtwork name={`entry-image-${entry.id}`}><img src={`/api/assets/${image.id}`} alt={entry.title} loading="lazy" width="600" height="400" /></SharedArtwork> : <span className={`ws-card-constellation ws-cover-${entry.kind}`}>{entry.kind === "music" ? <span className="ws-track-number">{String((currentPage - 1) * pageSize + index + 1).padStart(2, "0")}</span> : entry.kind === "albums" ? <span className="ws-cover-typography"><span>ALBUM / ARCHIVE</span><strong>{entry.title}</strong><span>{entry.data.year || "年份未注明"}</span></span> : <>{iconFor(entry.kind)}<span className="ws-cover-kind">{isPhoto ? "尚未添加照片文件" : kindLabels[entry.kind]}</span></>}</span>}
              {isPhoto && image && <span className="ws-image-hint">查看照片 <ImageIcon size={14} /></span>}
            </button>}
            <div className="ws-card-body">{["albums", "photos"].includes(categoryKind) && <GlassLayers />}<div className="ws-card-meta"><span>{entryDate(entry)}</span><span>{entry.data.status === "draft" ? "草稿" : entry.data.category || kindLabels[entry.kind]}</span></div>
              <h2><button aria-pressed={entry.kind === "music" ? music?.selectedId === entry.id : undefined} onClick={() => openListEntry(entry)}>{entry.title}</button></h2>
              <p>{entry.data.description?.slice(0, 105) || (entry.kind === "memory-book" ? `已亲自选定 ${entry.data.itemIds?.length || 0} 份记录。` : entry.data.artist || "留给自己的一份珍藏。")}</p>
              <footer>{playable && <button className="ws-track-play" aria-label={`${active ? "暂停" : "播放"}${entry.title}`} onClick={() => { music?.select(entry.id); if (active) music?.pause(); else music?.play(entry.id); }}>{active ? <Pause size={13} /> : <Play size={13} />}{active ? "暂停" : external ? "网易云播放" : "播放"}</button>}
                {!readOnly && isPhoto && !image && <button className="ws-track-play" aria-label={`为${entry.title}添加照片`} onClick={() => importMedia("photos", entry)}><ImagePlus size={14} />添加照片</button>}
                {!readOnly && entry.kind === "music" && !playable && <button className="ws-track-play" aria-label={`为${entry.title}添加音频`} onClick={() => importMedia("music", entry)}><Upload size={13} />添加音频</button>}
                {!readOnly && <button className={`ws-icon-button ${entry.favorite ? "is-favorite" : ""}`} aria-label={entry.favorite ? `取消收藏${entry.title}` : `收藏${entry.title}`} aria-pressed={entry.favorite} onClick={() => void favorite(entry)}><Heart size={17} fill={entry.favorite ? "currentColor" : "none"} /></button>}
                {entry.kind === "memory-book" ? <button className="ws-link-button" onClick={() => setBook(entry)}>纸张预览 <ArrowRight size={14} /></button> : <Link href={routeFor(entry)} className="ws-link-button">展开记忆 <ArrowRight size={14} /></Link>}
                {!readOnly && <button className="ws-icon-button" aria-label={`编辑${entry.title}`} onClick={() => setEditor({ kind: entry.kind, entry })}><Edit3 size={16} /></button>}
              </footer>
            </div>
          </motion.article>;
        })}</MotionList><nav className="ws-pagination" aria-label="记录分页"><span>第 {currentPage} / {maxPage} 页</span><button className="ws-icon-button" aria-label="上一页" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}><ChevronLeft size={19} /></button><button className="ws-icon-button" aria-label="下一页" disabled={currentPage >= maxPage} onClick={() => setPage(currentPage + 1)}><ChevronRight size={19} /></button></nav></>}</MotionSwap>
        </>}</MotionSwap>
      </>}
    </>}
    <AnimatePresence>
    {!readOnly && importKind && <MediaImporter key={`import-${importKind}-${importTarget?.id || "new"}`} kind={importKind} targetEntry={importTarget} entries={entries} assets={assets} settings={settings} onClose={() => setImportKind(null)} onSaved={onSaved} onAsset={onAsset} />}
    {!readOnly && editor && <EntryEditor key={`${editor.kind}-${editor.entry?.id || "new"}`} kind={editor.kind} entry={editor.entry} initialData={editor.initialData} entries={entries} assets={assets} settings={settings} onClose={() => setEditor(null)} onSaved={onSaved} onAsset={onAsset} />}
    {detail && <Modal key="entry-detail" title={kindLabels[detail.kind]} onClose={() => setDetail(null)} wide><MotionSwap motionKey={detail.id}><EntryDetail readOnly={readOnly} entry={detail} entries={entries} assets={assets} onEdit={() => { setEditor({ kind: detail.kind, entry: detail }); setDetail(null); }} onDelete={() => { setDeleteIds([detail.id]); setDetail(null); }} onFavorite={() => void favorite(detail)} onOpen={open} onBook={() => { setBook(detail); setDetail(null); }} /></MotionSwap></Modal>}
    {!readOnly && deleteIds.length > 0 && <Modal key="delete-entries" closeDisabled={busy} title={`删除 ${deleteIds.length} 份记录？`} onClose={() => { if (!busy) setDeleteIds([]); }}><p className="ws-muted">这一步会删除选定记录。媒体文件会保留在素材库，关联到这些记录的连接会由服务端清理。</p><ul className="ws-delete-list">{deleteIds.slice(0, 8).map(id => <li key={id}>{entries.find(entry => entry.id === id)?.title || "记录"}</li>)}</ul><MotionPresence show={!!error}><p className="ws-error" role="alert">{error}</p></MotionPresence><div className="ws-actions"><button className="ws-button ws-button-ghost" disabled={busy} onClick={() => setDeleteIds([])}>保留记录</button><button className="ws-button ws-button-danger" disabled={busy} onClick={() => void removeEntries()}>{busy ? <LoaderCircle size={15} className="ws-spin" /> : <Trash2 size={15} />}{busy ? "删除中…" : "确认删除"}</button></div></Modal>}
    {lightbox !== null && <PhotoLightbox key="photo-lightbox" photos={photos} index={lightbox} onClose={() => setLightbox(null)} />}
    {book && <MemoryBookPreview key="memory-book" book={book} entries={entries} assets={assets} onClose={() => setBook(null)} />}
    {!readOnly && deleteAsset && <Modal key="delete-asset" closeDisabled={busy} title="删除这个素材文件？" onClose={() => setDeleteAsset(null)}><p className="ws-muted">{deleteAsset.filename}。删除会移除原始文件；服务端会检查记录与首页引用，仍被使用的素材会拒绝删除。</p><MotionPresence show={!!error}><p className="ws-error" role="alert">{error}</p></MotionPresence><div className="ws-actions"><button className="ws-button ws-button-ghost" onClick={() => setDeleteAsset(null)}>保留素材</button><button className="ws-button ws-button-danger" disabled={busy} onClick={() => void removeAsset()}>确认删除素材</button></div></Modal>}
  </AnimatePresence>
  </div>;
}
