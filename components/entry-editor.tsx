"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { motion } from "motion/react";
import { ArrowDown, ArrowUp, Check, ChevronDown, FileUp, ImagePlus, Link2, LoaderCircle, Plus, RotateCcw, SlidersHorizontal, X } from "lucide-react";
import { kindLabels, type Asset, type Entry, type EntryData, type EntryKind, type SiteSettings } from "@/lib/types";
import { parseNeteaseMusic } from "@/lib/netease";
import {uploadMedia, type MediaUpload} from "@/lib/media-upload";
import { Modal, request, errorMessage } from "./client-utils";
import { MotionList, MotionPresence, MotionSwap, useMotionPreference } from "./motion";
import "./simple-editor.css";

type AssetUploadState = { uploading: boolean; pending: boolean; filename?: string };

export function AssetUploader({ mediaType, settings, onUploaded, onStateChange, saveTarget = "record", label = "上传素材" }: { mediaType: "image" | "audio" | "video"; settings: SiteSettings; onUploaded: (asset: Asset) => void; onStateChange?: (state: AssetUploadState) => void; saveTarget?: "record" | "settings"; label?: string }) {
  const [file, setFile] = useState<File | null>(null); const [progress, setProgress] = useState(0); const [uploading, setUploading] = useState(false); const [error, setError] = useState(""); const [success, setSuccess] = useState("");
  const xhr = useRef<MediaUpload | null>(null);
  const preview = useRef<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  useEffect(() => () => {
    xhr.current?.detach();
    if (preview.current) URL.revokeObjectURL(preview.current);
  }, []);
  const limit = mediaType === "image" ? settings.imageLimitMb : mediaType === "audio" ? settings.audioLimitMb : settings.videoLimitMb;
  const accept = mediaType === "image" ? ".jpg,.jpeg,.png,.webp,.gif,.avif" : mediaType === "audio" ? ".mp3,.wav,.ogg,.flac,.m4a" : ".mp4,.webm";
  function chooseFile(next: File | null) {
    if (uploading) return;
    if (preview.current) URL.revokeObjectURL(preview.current);
    preview.current = next && mediaType === "image" && typeof URL.createObjectURL === "function" ? URL.createObjectURL(next) : null;
    setPreviewUrl(preview.current); setFile(next); setSuccess(""); setError(""); setProgress(0);
    onStateChange?.({ uploading: false, pending: !!next, filename: next?.name });
  }
  function upload() {
    if (!file || uploading) return;
    setError(""); setSuccess("");
    if (file.size > limit * 1024 * 1024) { setError(`文件超过当前 ${limit} MB 限制。可在设置中调整限制或保留外部链接。`); return; }
    setUploading(true); setProgress(0); onStateChange?.({ uploading: true, pending: true, filename: file.name });
    xhr.current = uploadMedia(file, {
      onProgress: setProgress,
      onUploaded(asset) {
        xhr.current = null; setUploading(false);
        if (asset.mediaType !== mediaType) {setError("服务器识别的文件类型与当前素材类型不同，请重新选择。"); onStateChange?.({uploading: false, pending: true, filename: file.name}); return;}
        setSuccess(saveTarget === "settings" ? `${file.name} 已上传，请保存网站设置以应用图片` : `${file.name} 已上传，请保存当前记录以完成关联`); onUploaded(asset);
        onStateChange?.({uploading: false, pending: false, filename: file.name});
      },
      onError(message) {xhr.current = null; setUploading(false); setError(message); onStateChange?.({uploading: false, pending: true, filename: file.name});},
    });
  }
  return <section className="ws-upload" aria-label={label}><div className="ws-upload-head"><FileUp size={18} /><strong>{label}</strong><span>{limit} MB 以内</span></div>
    <label className="ws-field">选择文件<input type="file" accept={accept} disabled={uploading} data-testid="upload-file" onChange={event => { const next = event.target.files?.[0]; if (next) chooseFile(next); event.target.value = ""; }} /></label>
    <MotionPresence show={!!file}><div className="simple-upload-selection"><MotionPresence show={!!previewUrl}><figure className="simple-photo-preview"><img src={previewUrl || undefined} alt={`待上传照片预览：${file?.name || ""}`} /><figcaption>{file?.name}</figcaption></figure></MotionPresence><p className="simple-upload-hint" role="status">{saveTarget === "settings" ? success ? "图片已上传，保存网站设置后即可应用。" : uploading ? "正在上传，请等待完成后保存网站设置。" : "已选择图片，尚未上传。请点击“上传文件”，再保存网站设置。" : success ? "文件已上传，点击下方“保存记录”后才会出现在当前记录中。" : uploading ? "正在上传，请等待完成后保存记录。" : "已选择文件，尚未上传。请点击“上传文件”，再保存当前记录。"}</p>{!uploading && !success && <button type="button" className="simple-text-button" onClick={() => chooseFile(null)}><X size={14} />移除所选文件</button>}</div></MotionPresence>
    <MotionPresence show={uploading}><div className="ws-upload-progress"><progress value={progress} max="100" aria-label="文件上传进度" /><span>{progress}%{progress === 100 ? " · 服务器正在校验文件…" : ""}</span></div></MotionPresence>
    <div className="ws-actions"><button className="ws-button ws-button-secondary" type="button" onClick={upload} disabled={!file || uploading || !!success} data-testid="upload-submit"><MotionSwap motionKey={uploading ? "uploading" : error ? "retry" : "idle"} as="span" className="ws-control-copy">{uploading ? <LoaderCircle size={15} className="ws-spin" /> : error ? <RotateCcw size={15} /> : <FileUp size={15} />}{uploading ? "上传中…" : error ? "重试上传" : "上传文件"}</MotionSwap></button><MotionPresence show={uploading} as="span"><button type="button" className="ws-button ws-button-ghost" disabled={progress === 100} onClick={() => xhr.current?.abort()}>取消上传</button></MotionPresence></div>
    <MotionPresence show={!!error}><p className="ws-error" role="alert">{error}</p></MotionPresence><MotionPresence show={!!success}><p className="ws-success" role="status"><Check size={14} />{success}</p></MotionPresence>
  </section>;
}

const categories: Partial<Record<EntryKind, string[]>> = { music: ["单曲", "专辑曲目", "现场音频", "其他音频"], videos: ["官方 MV", "演唱会现场", "舞台表演", "官方宣传", "宣传影像", "其他影像"], photos: ["演唱会舞台", "音乐作品", "宣传照片", "个人原创设计", "照片", "纪念物", "其他"], timeline: ["音乐作品", "个人记忆", "演唱会", "生活片段"], concerts: ["亲临现场", "官方线上观看", "其他记忆"], milestones: ["纪念日", "生日", "作品纪念", "私人日期"] };

export function EntryEditor({ kind, entry, initialData, entries, assets, settings, onClose, onSaved, onAsset }: { kind: EntryKind; entry?: Entry; initialData?: EntryData; entries: Entry[]; assets: Asset[]; settings: SiteSettings; onClose: () => void; onSaved: (entry: Entry) => void; onAsset: (asset: Asset) => void }) {
  const animated = useMotionPreference();
  const editorId = useId();
  const itemMotion = { layout: animated ? "position" as const : false, initial: animated ? { opacity: 0, y: 6 } : false as const, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: animated ? -4 : 0 }, transition: { duration: animated ? .28 : 0, ease: [.22, 1, .36, 1] as [number, number, number, number] } };
  const [title, setTitle] = useState(entry?.title || "");
  const [data, setData] = useState<EntryData>(() => {
    const existing = { ...initialData, ...entry?.data };
    const precision = existing.date?.length === 4 ? "year" : existing.date?.length === 7 ? "month" : "day";
    return { datePrecision: precision, status: "saved", ...existing };
  });
  const [favorite, setFavorite] = useState(entry?.favorite || false);
  const [isPublic, setIsPublic] = useState(entry?.isPublic === true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploadStates, setUploadStates] = useState<Record<string, AssetUploadState>>({});
  const uploadStatesRef = useRef<Record<string, AssetUploadState>>({});
  const uploading = Object.values(uploadStates).some(state => state.uploading);
  const pendingUpload = Object.values(uploadStates).some(state => state.pending);
  function updateUploadState(source: "media" | "cover", state: AssetUploadState) {
    uploadStatesRef.current = { ...uploadStatesRef.current, [source]: state };
    setUploadStates(uploadStatesRef.current);
  }
  const [tagText, setTagText] = useState((entry?.data.tags || initialData?.tags)?.join("，") || "");
  const initialMusicSource = kind === "music" ? (entry?.data.externalUrl || initialData?.externalUrl || "") : "";
  const [musicSourceText, setMusicSourceText] = useState(initialMusicSource);
  const [musicPlaybackMode, setMusicPlaybackMode] = useState<"local" | "platform">(() => {
    const sourceType = entry?.data.sourceType || initialData?.sourceType;
    return sourceType === "official_embed" || sourceType === "external_link" ? "platform" : "local";
  });
  const [relationshipQuery, setRelationshipQuery] = useState("");
  const [mediaOpen, setMediaOpen] = useState(kind === "photos");
  const [moreOpen, setMoreOpen] = useState(kind === "photos" && !data.assetId);
  const [advancedSection, setAdvancedSection] = useState<"organize" | "media" | "relations">(kind === "photos" ? "media" : "organize");
  const isWriting = kind === "letters" || kind === "journal";
  const isMedia = ["music", "videos", "photos", "albums"].includes(kind);
  const hasCover = ["music", "videos", "journey", "concerts", "timeline"].includes(kind);
  const usesYear = ["music", "albums", "journey"].includes(kind);
  const hasDate = kind !== "memory-book" && !usesYear;
  const change = <K extends keyof EntryData>(key: K, value: EntryData[K]) => setData(current => ({ ...current, [key]: value }));
  const field = (key: keyof EntryData, label: string, placeholder?: string, type = "text") => <label className="ws-field simple-field" key={key}>{label}<input type={type} value={String(data[key] ?? "")} onChange={event => change(key, type === "number" ? (event.target.value ? Number(event.target.value) : undefined) : event.target.value)} placeholder={placeholder} {...(key === "year" ? { min: 1900, max: 2200 } : {})} /></label>;
  const assetType = kind === "music" ? "audio" : kind === "videos" ? "video" : "image";
  const assetKey = kind === "albums" || !isMedia ? "coverAssetId" : "assetId";
  const selectedAsset = assets.find(asset => asset.id === data[assetKey]);
  const itemIds = data.itemIds || [];
  const mediaLabel = kind === "music" ? "添加音频" : kind === "videos" ? "添加视频" : kind === "albums" ? "添加封面" : "添加照片";
  function moveItem(index: number, direction: number) { const next = [...itemIds]; [next[index], next[index + direction]] = [next[index + direction], next[index]]; change("itemIds", next); }
  function chooseDate(value: string) {
    setData(current => ({ ...current, date: value || undefined, year: value ? Number(value.slice(0, 4)) : current.year }));
  }
  function setPrecision(precision: EntryData["datePrecision"]) {
    setData(current => ({ ...current, datePrecision: precision, date: precision === "unknown" ? undefined : precision === "year" ? current.date?.slice(0, 4) : precision === "month" && (current.date?.length || 0) >= 7 ? current.date?.slice(0, 7) : precision === "day" && current.date?.length === 10 ? current.date : undefined }));
  }
  async function save(status: "saved" | "draft") {
    if (busy) return;
    const uploads = Object.values(uploadStatesRef.current);
    if (uploads.some(state => state.uploading)) { setError("文件正在上传，请等待上传完成后再保存记录。"); return; }
    if (uploads.some(state => state.pending)) {
      setError("你已选择文件，但尚未完成上传。请先点击“上传文件”，或移除所选文件，再保存记录。");
      setMoreOpen(true); setAdvancedSection("media"); return;
    }
    if (kind === "photos" && !data.assetId) {
      setError("还没有添加照片文件。请选择素材库中的照片，或上传照片后再保存记录。");
      setMediaOpen(true); setMoreOpen(true); setAdvancedSection("media"); return;
    }
    setBusy(true); setError("");
    try {
      if (!title.trim()) throw new Error("请为这份记录写一个标题。");
      const savedData: EntryData = { ...data, status };
      if (kind === "music") {
        const source = musicSourceText.trim();
        if (source) {
          const parsed = parseNeteaseMusic(source);
          if (parsed) {
            savedData.externalUrl = parsed.url;
            if (musicPlaybackMode === "platform" || !savedData.assetId) {
              savedData.sourceType = "official_embed";
              savedData.allowedUseScope = [...new Set([...(savedData.allowedUseScope || []), "official_embed"])];
            } else savedData.sourceType = "authorized_upload";
          } else {
            if (/<\/?iframe\b|[<>]/i.test(source)) throw new Error("播放器代码仅支持网易云官方播放器 iframe；请粘贴网易云歌曲链接或官方播放器代码。");
            let url: URL;
            try { url = new URL(source); } catch { throw new Error("请粘贴有效的网址、网易云歌曲链接或官方播放器代码。"); }
            if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("平台链接必须使用有效的 HTTP 或 HTTPS 地址。");
            if (/(^|\.)163\.com$/i.test(url.hostname)) throw new Error("这不是可识别的网易云歌曲地址，请使用歌曲页面链接或包含歌曲 ID 的官方播放器代码。");
            savedData.externalUrl = url.toString();
            savedData.sourceType = musicPlaybackMode === "platform" || !savedData.assetId ? "external_link" : "authorized_upload";
          }
        } else if ((entry?.data.externalUrl || initialData?.externalUrl) && !source) {
          delete savedData.externalUrl;
          if (savedData.assetId) savedData.sourceType = "authorized_upload";
          else if (savedData.sourceType !== "authorized_upload") delete savedData.sourceType;
        } else if (savedData.assetId && musicPlaybackMode === "local") {
          savedData.sourceType = "authorized_upload";
        }
      }
      const result = await request<{ entry: Entry }>(entry ? `/api/entries/${entry.id}` : "/api/entries", { method: entry ? "PATCH" : "POST", body: JSON.stringify({ ...(entry ? {} : { kind }), title: title.trim(), data: savedData, favorite, isPublic }) });
      onSaved(result.entry);
    } catch (failure) {
      setError(errorMessage(failure));
      // Existing advanced settings can require a correction even when they are folded.
      if (data.sourceType === "official_embed") { setMoreOpen(true); setAdvancedSection("media"); }
    } finally { setBusy(false); }
  }
  function submit(event: FormEvent) { event.preventDefault(); void save("saved"); }
  const candidates = entries.filter(item => item.id !== entry?.id && item.kind !== "memory-book" && `${item.title} ${kindLabels[item.kind]}`.toLowerCase().includes(relationshipQuery.toLowerCase()));
  const dateField = <MotionPresence show={data.datePrecision !== "unknown"} className="simple-date-field"><label className="ws-field simple-field">记录日期<MotionSwap motionKey={data.datePrecision || "day"}><input type={data.datePrecision === "month" ? "month" : data.datePrecision === "year" ? "number" : "date"} value={data.date || ""} onChange={event => chooseDate(event.target.value)} {...(data.datePrecision === "year" ? { min: 1900, max: 2200, placeholder: "可留空" } : {})} /></MotionSwap></label></MotionPresence>;
  return <Modal closeDisabled={busy || uploading} title={`${entry ? "编辑" : "新增"}${kindLabels[kind]}`} onClose={onClose} wide><form onSubmit={submit} className={`ws-editor simple-editor ${isWriting ? "ws-editor-writing" : ""}`}>
    {kind === "photos" && <div className="simple-editor-intro"><span className="simple-editor-signal" aria-hidden="true" /><p>保存后，照片会出现在照片馆</p></div>}
    <label className="ws-field simple-field ws-title-field">标题<input value={title} onChange={event => setTitle(event.target.value)} required maxLength={200} placeholder={kind === "letters" ? "这次，想对他说什么" : kind === "journey" ? "给这一年留一个标题" : "写一个你会记得的名字"} autoFocus /></label>
    <div className="simple-primary-date">
      {usesYear && field("year", "年份", "可留空，例如 2009", "number")}
      {hasDate && kind !== "milestones" && dateField}
      {kind === "milestones" && field("scheduledDate", "下一次纪念日期", undefined, "date")}
      {hasDate && kind !== "milestones" && data.datePrecision === "unknown" && <p className="simple-date-unknown">日期待核实<button type="button" onClick={() => setPrecision("day")}>添加日期</button></p>}
    </div>
    {kind === "music" && <div className="simple-music-source"><label className="ws-field simple-field">网易云链接或播放器代码<input type="text" aria-label="网易云链接或播放器代码" value={musicSourceText} onChange={event => { const value = event.target.value; setMusicSourceText(value); if (value.trim()) setMusicPlaybackMode("platform"); else if (data.assetId) setMusicPlaybackMode("local"); }} placeholder="粘贴网易云歌曲链接或 iframe 代码" autoComplete="url" /></label>{data.assetId && <label className="ws-field simple-field">播放来源<select value={musicPlaybackMode} onChange={event => setMusicPlaybackMode(event.target.value as "local" | "platform")}><option value="local">本地音频</option><option value="platform" disabled={!musicSourceText.trim()}>网易云或平台链接</option></select></label>}</div>}
    <label className="ws-field simple-field simple-content-field">{isWriting ? "正文" : "内容"}<textarea className={isWriting ? "ws-writing-area" : ""} value={data.description || ""} onChange={event => change("description", event.target.value)} rows={isWriting ? 6 : 4} placeholder={kind === "letters" ? "亲爱的张杰，\n\n今天想对你说……" : isWriting ? "把此刻的心情写下来。" : "一句话、一段资料，或这份珍藏的故事。"} /></label>
    <section className="simple-disclosure simple-publication" aria-label="访客可见范围">
      <label className="ws-check"><input type="checkbox" checked={isPublic} onChange={event => setIsPublic(event.target.checked)} /><span>公开给访客</span></label>
      <p className="simple-section-note">开启后，访客可以在对应分类查看这条记录及关联媒体。个人笔记始终私密。{isWriting && "草稿即使勾选公开，也不会显示给访客。"}</p>
    </section>
    {(isMedia || hasCover) && <section className="simple-disclosure">
      <button type="button" className="simple-disclosure-toggle" aria-expanded={mediaOpen} aria-controls={`${editorId}-media`} onClick={() => setMediaOpen(open => !open)}><ImagePlus size={17} /><span>{selectedAsset ? `已添加 ${selectedAsset.filename}` : mediaLabel}<small>{selectedAsset ? "点击更换" : kind === "photos" ? "选择或上传照片" : "可选"}</small></span><ChevronDown size={15} className={mediaOpen ? "is-open" : ""} /></button>
      <MotionPresence show={mediaOpen} preset="panel"><div id={`${editorId}-media`} className="simple-disclosure-body">
        <MotionPresence show={selectedAsset?.mediaType === "image"}><figure className="simple-photo-preview"><img key={selectedAsset?.id} src={selectedAsset ? `/api/assets/${selectedAsset.id}` : undefined} alt={`已关联照片预览：${selectedAsset?.filename || ""}`} /><figcaption>{selectedAsset?.filename}</figcaption></figure></MotionPresence>
        <label className="ws-field simple-field">选择素材库文件<select value={data[assetKey] || ""} disabled={uploading} onChange={event => change(assetKey, event.target.value || undefined)}><option value="">暂不添加</option>{assets.filter(item => item.mediaType === (isMedia ? assetType : "image")).map(asset => <option key={asset.id} value={asset.id}>{asset.filename}</option>)}</select></label>
        <button type="button" className="simple-text-button" onClick={() => { setMoreOpen(true); setAdvancedSection("media"); }}><FileUp size={14} />上传新文件</button>
      </div></MotionPresence>
    </section>}
    {kind === "memory-book" && <section className="simple-disclosure">
      <button type="button" className="simple-disclosure-toggle" aria-expanded={mediaOpen} aria-controls={`${editorId}-book`} onClick={() => setMediaOpen(open => !open)}><Plus size={17} /><span>选择纪念册内容<small>{itemIds.length ? `已选 ${itemIds.length} 份` : "可稍后添加"}</small></span><ChevronDown size={15} className={mediaOpen ? "is-open" : ""} /></button>
      <MotionPresence show={mediaOpen} preset="panel"><div id={`${editorId}-book`} className="simple-disclosure-body"><input className="ws-inline-input" aria-label="筛选纪念册记录" value={relationshipQuery} onChange={event => setRelationshipQuery(event.target.value)} placeholder="搜索记录" /><MotionList className="ws-selection-list">{candidates.map(item => <motion.label className="ws-check" key={item.id} data-motion-managed {...itemMotion}><input type="checkbox" checked={itemIds.includes(item.id)} onChange={event => change("itemIds", event.target.checked ? [...itemIds, item.id] : itemIds.filter(id => id !== item.id))} /><span>{item.title}<small>{kindLabels[item.kind]}</small></span></motion.label>)}{!candidates.length && <motion.p key="empty-book" className="ws-muted" data-motion-managed {...itemMotion}>保存一些记录后，就可以把它们编成纪念册。</motion.p>}</MotionList>
        <MotionPresence show={itemIds.length > 0}><MotionList className="ws-book-order">{itemIds.map((id, index) => <motion.div key={id} data-motion-managed {...itemMotion}><span>{index + 1}. {entries.find(item => item.id === id)?.title || "记录已删除"}</span><button type="button" className="ws-icon-button" aria-label="向前移动" disabled={!index} onClick={() => moveItem(index, -1)}><ArrowUp size={16} /></button><button type="button" className="ws-icon-button" aria-label="向后移动" disabled={index === itemIds.length - 1} onClick={() => moveItem(index, 1)}><ArrowDown size={16} /></button><button type="button" className="ws-icon-button" aria-label="移出纪念册" onClick={() => change("itemIds", itemIds.filter(item => item !== id))}><X size={16} /></button></motion.div>)}</MotionList></MotionPresence>
      </div></MotionPresence>
    </section>}
    <section className="simple-disclosure simple-more">
      <button type="button" className="simple-disclosure-toggle" aria-expanded={moreOpen} aria-controls={`${editorId}-advanced`} disabled={uploading || pendingUpload} onClick={() => setMoreOpen(open => !open)}><SlidersHorizontal size={16} /><span>更多设置{pendingUpload && <small>完成上传或移除文件后可折叠</small>}</span><ChevronDown size={15} className={moreOpen ? "is-open" : ""} /></button>
      <MotionPresence show={moreOpen} preset="panel"><div id={`${editorId}-advanced`} className="simple-disclosure-body simple-advanced">
        {kind !== "memory-book" && <div className="simple-section-switch" role="group" aria-label="更多设置分类"><button type="button" aria-pressed={advancedSection === "organize"} disabled={uploading || pendingUpload} onClick={() => setAdvancedSection("organize")}>整理记录</button><button type="button" aria-pressed={advancedSection === "media"} disabled={uploading || pendingUpload} onClick={() => setAdvancedSection("media")}>媒体与来源</button><button type="button" aria-pressed={advancedSection === "relations"} disabled={uploading || pendingUpload} onClick={() => setAdvancedSection("relations")}>关联记录</button></div>}
        <MotionSwap motionKey={kind === "memory-book" ? "organize" : advancedSection}>
          {(advancedSection === "organize" || kind === "memory-book") && <div className="simple-advanced-section">
            <div className="ws-form-grid simple-form-grid">
              {categories[kind] ? <label className="ws-field simple-field">分类<select value={data.category || ""} onChange={event => change("category", event.target.value)}><option value="">暂不分类</option>{categories[kind]?.map(category => <option key={category}>{category}</option>)}</select></label> : field("category", "分类", "可留空")}
              {(kind === "music" || kind === "albums") && field("artist", "艺术家", "歌手姓名")}
              {(kind === "music" || kind === "videos") && <label className="ws-field simple-field">关联专辑<select value={data.albumId || ""} onChange={event => change("albumId", event.target.value || undefined)}><option value="">暂无关联</option>{entries.filter(item => item.kind === "albums").map(album => <option key={album.id} value={album.id}>{album.title}</option>)}</select></label>}
              {kind === "concerts" && <>{field("city", "城市")}{field("venue", "场馆")}{field("attendance", "参与方式", "现场 / 线上观看 / 其他")}</>}
              {(kind === "journey" || isWriting || kind === "concerts") && <>{field("mood", "当时的心情")}{field("lifeStage", "生活阶段", "可留空")}</>}
              {kind !== "memory-book" && <label className="ws-field simple-field">日期精度<select value={data.datePrecision || "day"} onChange={event => setPrecision(event.target.value as EntryData["datePrecision"])}><option value="day">具体日期</option><option value="month">年月</option><option value="year">年份</option><option value="unknown">日期待核实</option></select></label>}
              {(usesYear || kind === "milestones") && dateField}
              {hasDate && field("year", "归档年份", "可留空", "number")}
            </div>
            {kind !== "memory-book" && <label className="ws-field simple-field">个人笔记<textarea rows={3} value={data.notes || ""} onChange={event => change("notes", event.target.value)} placeholder="补充想记住的细节" /></label>}
            <label className="ws-field simple-field">标签<input value={tagText} onChange={event => { setTagText(event.target.value); change("tags", [...new Set(event.target.value.split(/[,，]/).map(tag => tag.trim()).filter(Boolean))]); }} placeholder="用逗号分隔，例如 夜晚，勇气" /></label>
            <div className="ws-check-grid simple-checks"><label className="ws-check"><input type="checkbox" checked={favorite} onChange={event => setFavorite(event.target.checked)} />加入我的收藏</label>{isMedia && <label className="ws-check"><input type="checkbox" checked={data.featured || false} onChange={event => change("featured", event.target.checked)} />设为精选素材</label>}{["timeline", "journey"].includes(kind) && <label className="ws-check"><input type="checkbox" checked={data.verified || false} onChange={event => change("verified", event.target.checked)} />资料已核实</label>}</div>
          </div>}
          {advancedSection === "media" && kind !== "memory-book" && <div className="simple-advanced-section">
            {(kind === "music" || kind === "videos") && <div className="ws-form-grid simple-form-grid">
              {kind === "videos" && field("externalUrl", "平台链接", "https://…", "url")}
              {kind === "videos" && <label className="ws-field simple-field">播放来源<select value={data.sourceType || "external_link"} onChange={event => change("sourceType", event.target.value as EntryData["sourceType"])}><option value="external_link">平台链接</option><option value="authorized_upload">本地文件</option><option value="official_embed">官方播放器</option></select></label>}
            </div>}
            {isMedia && <AssetUploader mediaType={assetType} settings={settings} label={kind === "albums" ? "上传专辑封面" : "上传媒体文件"} onStateChange={state => updateUploadState("media", state)} onUploaded={asset => { onAsset(asset); change(assetKey, asset.id); }} />}
            {hasCover && <fieldset className="ws-fieldset"><legend>封面照片</legend><label className="ws-field simple-field">选择已有封面<select value={data.coverAssetId || ""} disabled={uploading} onChange={event => change("coverAssetId", event.target.value || undefined)}><option value="">暂不添加</option>{assets.filter(item => item.mediaType === "image").map(asset => <option key={asset.id} value={asset.id}>{asset.filename}</option>)}</select></label><AssetUploader mediaType="image" settings={settings} label="上传封面" onStateChange={state => updateUploadState("cover", state)} onUploaded={asset => { onAsset(asset); change("coverAssetId", asset.id); }} /></fieldset>}
          </div>}
          {advancedSection === "relations" && kind !== "memory-book" && <div className="simple-advanced-section"><p className="simple-section-note"><Link2 size={15} />把同一段时光里的作品与回忆连在一起</p><input className="ws-inline-input" aria-label="筛选关联记录" value={relationshipQuery} onChange={event => setRelationshipQuery(event.target.value)} placeholder="搜索标题或类型" /><MotionList className="ws-selection-list">{candidates.length ? candidates.map(item => <motion.label className="ws-check" key={item.id} data-motion-managed {...itemMotion}><input type="checkbox" checked={data.relatedIds?.includes(item.id) || false} onChange={event => change("relatedIds", event.target.checked ? [...(data.relatedIds || []), item.id] : data.relatedIds?.filter(id => id !== item.id))} /><span>{item.title}<small>{kindLabels[item.kind]}</small></span></motion.label>) : <motion.p key="empty-related" className="ws-muted" data-motion-managed {...itemMotion}>还没有可关联的记录，之后可以回来添加。</motion.p>}</MotionList></div>}
        </MotionSwap>
      </div></MotionPresence>
    </section>
    <MotionPresence show={!!error}><p className="ws-error" role="alert">{error}</p></MotionPresence>
    <div className="ws-editor-footer simple-editor-footer">{(uploading || pendingUpload) && <p className="ws-tiny" role={uploading ? "status" : undefined}>{uploading ? "文件正在上传，请稍候" : "文件尚未上传，请先完成上传"}</p>}<div className="ws-actions"><button type="button" className="ws-button ws-button-ghost" onClick={onClose} disabled={busy || uploading}>取消</button>{isWriting && <button type="button" className="ws-button ws-button-secondary" disabled={busy || uploading} onClick={() => void save("draft")}>保存草稿</button>}<button type="submit" className="ws-button" disabled={busy || uploading} data-testid="entry-save"><MotionSwap motionKey={busy ? "saving" : "idle"} as="span" className="ws-control-copy">{busy ? <LoaderCircle size={16} className="ws-spin" /> : <Check size={16} />}{busy ? "保存中…" : "保存记录"}</MotionSwap></button></div></div>
  </form></Modal>;
}
