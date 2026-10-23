import type {Asset} from "./types";

type UploadCallbacks = {onProgress: (percentage: number) => void; onUploaded: (asset: Asset) => void; onError: (message: string) => void};
export type MediaUpload = {abort: () => void; detach: () => void};
type UploadInitialization = {intentId: string; signedUrl: string; mimeType: string};
const cancellationMessage = "已停止本次传输，服务端保存状态尚未确认；已保存的文件会保留在素材库。";

async function jsonResponse<T>(response: Response): Promise<T> {
  const value = await response.json().catch(() => null);
  if (!response.ok) throw new Error(typeof value?.error === "string" ? value.error : `上传未完成（${response.status}），请重试。`);
  return value as T;
}
function signatureBase64(file: File): Promise<string> {
  // FileReader also works on browsers which do not implement Blob.arrayBuffer.
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(new Error("文件读取失败，请重新选择。"));
    reader.readAsDataURL(file.slice(0, 4096));
  });
}

export function uploadMedia(file: File, callbacks: UploadCallbacks): MediaUpload {
  let connection: XMLHttpRequest | null = null;
  let detached = false, cancelled = false, finished = false, completing = false;
  const controller = new AbortController();
  function notifyError(message: string) {if (!detached && !finished) {finished = true; callbacks.onError(message);}}
  function notifyAsset(asset: Asset) {if (!detached && !finished) {finished = true; callbacks.onProgress(100); callbacks.onUploaded(asset);}}
  const handle: MediaUpload = {
    abort() {
      // Once validation/commit begins, retain the result instead of racing a
      // cancellation against creation of a library asset.
      if (finished || completing) return;
      cancelled = true; controller.abort(); connection?.abort();
    },
    detach() {detached = true; handle.abort();},
  };

  if (process.env.NEXT_PUBLIC_DATA_MODE !== "supabase") {
    const form = new FormData(); form.append("file", file);
    const xhr = new XMLHttpRequest(); connection = xhr;
    xhr.open("POST", "/api/assets"); xhr.responseType = "json";
    xhr.upload.onprogress = event => {if (!detached && event.lengthComputable) callbacks.onProgress(Math.round(event.loaded / event.total * 100));};
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300 && xhr.response?.asset) notifyAsset(xhr.response.asset);
      else notifyError(typeof xhr.response?.error === "string" ? xhr.response.error : `上传未完成（${xhr.status}），请重试。`);
    };
    xhr.onerror = () => notifyError("连接中断，服务端保存状态尚未确认。请检查连接后再试。");
    xhr.onabort = () => notifyError(cancellationMessage);
    try {xhr.send(form);} catch {notifyError("上传连接无法建立，请检查连接后再试。");}
    return handle;
  }

  void (async () => {
    let intentId: string | undefined;
    try {
      const signature = await signatureBase64(file);
      if (cancelled) throw new DOMException("Aborted", "AbortError");
      // Let init finish even if cancelled: its response identifies the temporary
      // object so we can clean up the intent after an interrupted initiation.
      const initialized = await jsonResponse<UploadInitialization>(await fetch("/api/assets/uploads/init", {
        method: "POST", headers: {"Content-Type": "application/json"},
        body: JSON.stringify({filename: file.name, mimeType: file.type, size: file.size, signature}),
      }));
      intentId = initialized.intentId;
      if (cancelled) throw new DOMException("Aborted", "AbortError");
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest(); connection = xhr;
        xhr.open("PUT", initialized.signedUrl); xhr.responseType = "json";
        xhr.setRequestHeader("Content-Type", initialized.mimeType);
        xhr.setRequestHeader("Cache-Control", "max-age=0");
        xhr.setRequestHeader("x-upsert", "false");
        xhr.upload.onprogress = event => {if (!detached && event.lengthComputable) callbacks.onProgress(Math.min(99, Math.round(event.loaded / event.total * 100)));};
        xhr.onload = () => xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`云端文件上传失败（${xhr.status}），请重试。`));
        xhr.onerror = () => reject(new Error("上传连接中断，请检查连接后重新上传。"));
        xhr.onabort = () => reject(new DOMException("Aborted", "AbortError"));
        xhr.send(file);
      });
      if (cancelled) throw new DOMException("Aborted", "AbortError");
      completing = true;
      if (!detached) callbacks.onProgress(100);
      const complete = () => fetch("/api/assets/uploads/complete", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({intentId}), signal: controller.signal});
      // Completion is idempotent. Retry one lost transport response, never upload
      // the bytes again after Storage has accepted them.
      const response = await complete().catch(() => complete());
      const result = await jsonResponse<{asset: Asset}>(response);
      if (!result?.asset) throw new Error("文件保存结果未确认，请检查素材库后再试。");
      notifyAsset(result.asset);
    } catch (error) {
      if (intentId && !completing) {
        await fetch("/api/assets/uploads/cancel", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({intentId}), keepalive: true, signal: AbortSignal.timeout(10_000)}).catch(() => {});
      }
      notifyError(cancelled ? cancellationMessage : error instanceof Error ? error.message : "文件上传未完成，请重试。");
    }
  })();
  return handle;
}
