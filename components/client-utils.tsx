"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { motion, usePresence } from "motion/react";
import { X } from "lucide-react";
import { defaultSettings, type Asset, type Entry, type SiteSettings } from "@/lib/types";
import { useMotionPreference } from "./motion";
import { GlassLayers } from "./liquid-glass-effects";

export async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...options, headers: { ...(options?.body instanceof FormData ? {} : { "Content-Type": "application/json" }), ...options?.headers } });
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof value.error === "string" ? value.error : "请求失败，请稍后重试。");
  return value as T;
}

export function errorMessage(error: unknown) { return error instanceof Error ? error.message : "操作未完成，请稍后重试。"; }

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a"); link.href = url; link.download = name; link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function selectedBackup<T extends { entries: Entry[]; assets: Asset[]; settings: SiteSettings }>(backup: T, ids: string[]): T {
  const selected = new Set(ids);
  const entries = backup.entries.filter(entry => selected.has(entry.id)).map(entry => ({ ...entry, data: { ...entry.data,
    relatedIds: entry.data.relatedIds?.filter(id => selected.has(id)),
    itemIds: entry.data.itemIds?.filter(id => selected.has(id)),
    chapters: entry.data.chapters?.filter(id => selected.has(id)),
    albumId: entry.data.albumId && selected.has(entry.data.albumId) ? entry.data.albumId : undefined,
  } }));
  const mediaIds = new Set(entries.flatMap(entry => [entry.data.assetId, entry.data.coverAssetId].filter((id): id is string => !!id)));
  return { ...backup, entries, assets: backup.assets.filter(asset => mediaIds.has(asset.id)), settings: { ...defaultSettings, featuredIds: backup.settings.featuredIds.filter(id => selected.has(id)) } };
}

const modalFocusStack: { container: HTMLDivElement; restoreFocus: HTMLElement | null }[] = [];
let originalBodyOverflow = "";

export function Modal({ title, children, onClose, wide = false, closeDisabled = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean; closeDisabled?: boolean }) {
  const enabled = useMotionPreference();
  const [present, safeToRemove] = usePresence();
  const [closing, setClosing] = useState(false);
  // Capture before React commits any autoFocus inputs inside the new dialog.
  const [opener] = useState<HTMLElement | null>(() => typeof document !== "undefined" && document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const dialog = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const closingRequested = useRef(false), completed = useRef(false), notified = useRef(false);
  const exiting = closing || !present;
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  const requestClose = useCallback(() => {
    if (closeDisabled || closingRequested.current) return;
    closingRequested.current = true;
    if (!enabled) { completed.current = true; notified.current = true; onCloseRef.current(); }
    else setClosing(true);
  }, [enabled, closeDisabled]);
  const requestCloseRef = useRef(requestClose);
  useEffect(() => { requestCloseRef.current = requestClose; }, [requestClose]);
  useEffect(() => {
    if (!present && (!enabled || completed.current)) safeToRemove?.();
    if (closing && !enabled && !notified.current && present) {
      completed.current = true; notified.current = true; onCloseRef.current();
    }
  }, [present, enabled, closing, safeToRemove]);

  useEffect(() => {
    const container = dialog.current;
    if (!container) return;
    const previous = modalFocusStack.at(-1)?.restoreFocus ?? opener;
    if (!modalFocusStack.length) { originalBodyOverflow = document.body.style.overflow; document.body.style.overflow = "hidden"; }
    const focusEntry = { container, restoreFocus: previous };
    modalFocusStack.push(focusEntry);
    const focusables = () => container?.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex="0"]');
    const controls = focusables(); if (controls?.length) controls[0].focus(); else container.focus();
    const onKey = (event: KeyboardEvent) => {
      if (modalFocusStack.at(-1) !== focusEntry) return;
      if (event.key === "Escape") { event.preventDefault(); requestCloseRef.current(); }
      if (event.key !== "Tab") return;
      const nodes = focusables(); if (!nodes?.length) { event.preventDefault(); return; }
      const first = nodes[0]; const last = nodes[nodes.length - 1];
      if (event.shiftKey && (document.activeElement === first || !container.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !container.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      const wasTop = modalFocusStack.at(-1) === focusEntry;
      const index = modalFocusStack.indexOf(focusEntry);
      if (index !== -1) modalFocusStack.splice(index, 1);
      if (!modalFocusStack.length) { document.body.style.overflow = originalBodyOverflow; if (previous?.isConnected) previous.focus(); }
      else if (wasTop) modalFocusStack.at(-1)?.container.querySelector<HTMLElement>('button:not([disabled]),a[href],input:not([disabled]),[tabindex="0"]')?.focus();
    };
  }, [opener]);

  function finishClose() {
    if (!exiting) return;
    completed.current = true;
    if (!present) safeToRemove?.();
    else if (!notified.current) { notified.current = true; onCloseRef.current(); }
  }

  const transition = { duration: enabled ? 0.18 : 0, ease: [0.22, 1, 0.36, 1] as const };
  const backdrop = <motion.div className="ws-modal-backdrop" data-motion-managed data-state={exiting ? "closing" : "open"}
    initial={enabled ? { opacity: 0 } : false} animate={{ opacity: exiting ? 0 : 1 }} transition={transition} onAnimationComplete={finishClose}
    onMouseDown={event => { if (event.target === event.currentTarget) requestClose(); }}
    onClickCapture={event => { if (exiting) { event.preventDefault(); event.stopPropagation(); } }}
    onSubmitCapture={event => { if (exiting) { event.preventDefault(); event.stopPropagation(); } }}>
    <motion.div className={`ws-modal ${wide ? "ws-modal-wide" : ""}`} role="dialog" aria-modal="true" aria-label={title} aria-busy={exiting} ref={dialog}
      tabIndex={-1} initial={enabled ? { opacity: 0, y: 14, scale: 0.985 } : false} animate={{ opacity: exiting ? 0 : 1, y: exiting && enabled ? 8 : 0, scale: exiting && enabled ? 0.985 : 1 }} transition={transition}>
      <div className="ws-modal-head"><h2>{title}</h2><button type="button" className="ws-icon-button" aria-label="关闭弹窗" disabled={closeDisabled} onClick={requestClose}><X size={20} /></button></div>
      <div className="ws-modal-body">{children}</div>
      <GlassLayers />
    </motion.div>
  </motion.div>;
  // Keep dialogs above the header and music dock while retaining the private theme.
  const layer = typeof document === "undefined" ? null : document.querySelector("[data-modal-root]");
  return layer ? createPortal(backdrop, layer) : backdrop;
}
