import { LoaderCircle } from "lucide-react";

export default function Loading() {
  return <div className="ws-route-loading" role="status" aria-live="polite"><LoaderCircle size={20} className="ws-spin" /><p>正在打开珍藏</p></div>;
}
