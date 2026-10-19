"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Check, FileAudio, FileImage, FileVideo, LoaderCircle, RotateCcw, Upload, X } from "lucide-react";
import type { Asset, Entry, SiteSettings } from "@/lib/types";
import { importEntryPayload, importFileError, importFileSize, importLimitMb, importTitle, mediaImportOptions, type ImportKind } from "@/lib/media-import";
import { errorMessage, Modal, request } from "./client-utils";
import { MotionPresence, MotionSwap } from "./motion";
import "./media-importer.css";

type MediaImporterProps = {
  kind: ImportKind;
  targetEntry?: Entry;
  entries: Entry[];
  assets: Asset[];
  settings: SiteSettings;
  onClose: () => void;
  onSaved: (entry: Entry) => void;
  onAsset: (asset: Asset) => void;
};

export function MediaImporter({ kind, targetEntry, entries, settings, onClose, onSaved, onAsset }: MediaImporterProps) {
  const options = mediaImportOptions[kind];
  const limit = importLimitMb(kind, settings);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState(targetEntry?.title || "");
  const [phase, setPhase] = useState<"ready" | "uploading" | "saving">("ready");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [uploadedAsset, setUploadedAsset] = useState<Asset | null>(null);
  const connection = useRef<XMLHttpRequest | null>(null);
  const reportedAssets = useRef(new Set<string>());
  const submissionLocked = useRef(false);
  const verifySavedEntry = useRef(false);
  const busy = phase !== "ready";
  const mediaSaved = !!uploadedAsset;
  const FileIcon = kind === "music" ? FileAudio : kind === "videos" ? FileVideo : FileImage;

  useEffect(() => () => {
    const active = connection.current;
    if (active) {
      active.onload = null; active.onerror = null; active.onabort = null; active.upload.onprogress = null;
      if (active.readyState !== 4) active.abort();
    }
  }, []);

  function chooseFile(next: File | null) {
    if (busy || uploadedAsset) return;
    setDragging(false);
    if (!next) return;
    const problem = importFileError(kind, next, limit);
    if (problem) { setFile(null); if (!targetEntry) setTitle(""); setProgress(0); setError(problem); return; }
    setFile(next); if (!targetEntry) setTitle(importTitle(next.name)); setError(""); setProgress(0);
  }

  async function saveEntry(asset: Asset) {
    setPhase("saving");
    try {
      const matches = (entry: Entry) => entry.kind === kind && entry.data.assetId === asset.id && (!targetEntry || entry.id === targetEntry.id);
      let existing = entries.find(matches);
      let target = targetEntry;
      // A lost response can follow a successful commit. Confirm this exact target or imported asset before retrying.
      if (!existing && verifySavedEntry.current) {
        if (targetEntry) {
          const current = await request<{ entry: Entry }>(`/api/entries/${targetEntry.id}`);
          if (matches(current.entry)) existing = current.entry;
          else target = current.entry;
        } else {
          const current = await request<{ entries: Entry[] }>(`/api/entries?kind=${kind}`);
          existing = current.entries.find(matches);
        }
      }
      const payload = importEntryPayload(kind, title, asset, target);
      const result = existing ? { entry: existing } : await request<{ entry: Entry }>(targetEntry ? `/api/entries/${targetEntry.id}` : "/api/entries", {
        method: targetEntry ? "PATCH" : "POST",
        body: JSON.stringify(targetEntry ? { title: payload.title, data: payload.data, favorite: payload.favorite } : payload),
      });
      verifySavedEntry.current = false;
      onSaved(result.entry);
    } catch (failure) {
      verifySavedEntry.current = true;
      setError(`文件已保存，记录保存未确认：${errorMessage(failure)} 可直接重试，无需重新上传。`);
    } finally {
      submissionLocked.current = false;
      setPhase("ready");
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (submissionLocked.current) return;
    setError("");
    if (targetEntry && targetEntry.kind !== kind) { setError("当前记录与素材类型不匹配，请返回对应栏目添加。"); return; }
    if (!title.trim()) { setError("请写一个标题。"); return; }
    if (uploadedAsset) { submissionLocked.current = true; void saveEntry(uploadedAsset); return; }
    if (!file) { setError(`请先选择${options.fileLabel}文件。`); return; }
    const problem = importFileError(kind, file, limit);
    if (problem) { setError(problem); return; }
    submissionLocked.current = true;
    setPhase("uploading"); setProgress(0);
    const form = new FormData();
    form.append("file", file);
    const active = new XMLHttpRequest(); connection.current = active;
    active.open("POST", "/api/assets"); active.responseType = "json";
    active.upload.onprogress = event => { if (event.lengthComputable) setProgress(Math.round((event.loaded / event.total) * 100)); };
    function fail(message: string) {
      if (connection.current !== active) return;
      connection.current = null; submissionLocked.current = false; setPhase("ready"); setError(message);
    }
    active.onload = () => {
      if (connection.current !== active) return;
      if (active.status < 200 || active.status >= 300 || !active.response?.asset) {
        fail(typeof active.response?.error === "string" ? active.response.error : `上传未完成（${active.status}），请重试。`); return;
      }
      const asset = active.response.asset as Asset;
      if (asset.mediaType !== options.mediaType) { fail("服务器识别的文件类型与当前栏目不同，请在对应栏目中添加。"); return; }
      connection.current = null; setUploadedAsset(asset); setProgress(100);
      if (!reportedAssets.current.has(asset.id)) { reportedAssets.current.add(asset.id); onAsset(asset); }
      void saveEntry(asset);
    };
    active.onerror = () => fail("连接中断，服务端保存状态尚未确认。请检查连接后再试。");
    active.onabort = () => fail("已停止本次传输，服务端保存状态尚未确认；已保存的文件会保留在素材库。");
    try { active.send(form); } catch (failure) { fail(errorMessage(failure)); }
  }

  return <Modal title={`添加${options.label}`} onClose={onClose} closeDisabled={busy}>
    <form className="media-importer" onSubmit={submit}>
      <p className="media-import-intro">{kind === "photos" ? "留下镜头里的那片星海" : kind === "videos" ? "把现场，留在自己的星海" : "把喜欢的歌，放进自己的星海"}</p>
      <label className={`media-import-drop ${dragging ? "is-dragging" : ""} ${file ? "has-file" : ""} ${busy || mediaSaved ? "is-locked" : ""}`}
        onDragOver={event => { event.preventDefault(); if (!busy && !mediaSaved) setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={event => { event.preventDefault(); if (event.dataTransfer.files.length > 1) { setDragging(false); setError("每次添加一个文件，完成后可以继续添加。"); return; } chooseFile(event.dataTransfer.files[0] || null); }}>
        <input type="file" aria-label={`选择${options.fileLabel}文件`} accept={options.accept} disabled={busy || mediaSaved} onChange={event => { chooseFile(event.target.files?.[0] || null); event.target.value = ""; }} />
        <MotionSwap motionKey={file ? "selected" : "empty"} className="media-import-file">
          <span className="media-import-file-icon" aria-hidden="true">{file ? <FileIcon size={29} strokeWidth={1.4} /> : <Upload size={28} strokeWidth={1.4} />}</span>
          <strong>{file ? file.name : `选择${options.fileLabel}文件，或拖到这里`}</strong>
          <span>{file ? `${importFileSize(file.size)}${mediaSaved ? " · 文件已保存" : " · 点击可更换"}` : `${options.formats} · 单个文件不超过 ${limit} MB`}</span>
        </MotionSwap>
      </label>
      <div className="media-import-fields">
        <label className="ws-field">标题<input value={title} onChange={event => setTitle(event.target.value)} maxLength={300} required disabled={busy} placeholder="选择文件后自动填写，可修改" /></label>
      </div>
      <MotionPresence show={busy}><div className="media-import-progress" role="status" aria-live="polite"><progress value={progress} max={100} aria-label="文件上传进度" /><span>{phase === "saving" ? "文件已保存，正在建立记录…" : progress === 100 ? "上传完成，正在校验文件…" : `正在上传 ${progress}%`}</span>{phase === "uploading" && <span className="media-import-progress-hint">关闭前请先取消上传</span>}</div></MotionPresence>
      <MotionPresence show={mediaSaved && !busy}><p className="media-import-retained" role="status"><Check size={15} />文件已在私人素材库，关闭后也会保留</p></MotionPresence>
      <MotionPresence show={!!error}><p className="ws-error media-import-error" role="alert">{error}</p></MotionPresence>
      <div className="media-import-footer">
        <p>{kind === "photos" ? "保存后即可在照片馆查看" : "保存后即可在站内播放"}</p>
        <div className="ws-actions">
          <MotionSwap motionKey={phase === "uploading" ? "cancel-upload" : "close"} as="span">
            {phase === "uploading" ? <button type="button" className="ws-button ws-button-ghost" onClick={() => connection.current?.abort()}><X size={14} />取消上传</button> : <button type="button" className="ws-button ws-button-ghost" disabled={busy} onClick={onClose}>{mediaSaved ? "关闭并保留文件" : "取消"}</button>}
          </MotionSwap>
          <button type="submit" className="ws-button" disabled={busy || !file} data-testid="media-import-submit"><MotionSwap motionKey={phase !== "ready" ? phase : mediaSaved ? "retry-save" : error ? "retry-upload" : "upload"} as="span" className="ws-control-copy">{busy ? <LoaderCircle size={16} className="ws-spin" /> : mediaSaved || error ? <RotateCcw size={16} /> : <Upload size={16} />}{phase === "uploading" ? "上传中…" : phase === "saving" ? "保存中…" : mediaSaved ? "重试保存记录" : error ? "重试上传并保存" : "上传并保存"}</MotionSwap></button>
        </div>
      </div>
    </form>
  </Modal>;
}
