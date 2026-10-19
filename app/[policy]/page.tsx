import Link from "next/link";
import { notFound } from "next/navigation";
import { VMark } from "@/components/v-mark";

const pages: Record<string, { title: string; eyebrow: string; sections: [string, string][] }> = {
  privacy: {
    title: "数据与备份",
    eyebrow: "DATA & BACKUP",
    sections: [
      ["数据存储", "本地模式将内容保存到 SQLite 数据库，媒体文件存储在本机受保护目录。浏览器仅使用 HttpOnly 会话 Cookie，不把记录或密码写入 localStorage。启用 Supabase 时，内容保存到你配置的 Supabase 项目。"],
      ["备份与恢复", "在设置中导出 JSON 内容，并单独备份媒体文件。完整迁移需要同时保存数据库和媒体目录；导入前可以预览，确认后再恢复。"],
    ],
  },
  copyright: {
    title: "照片来源",
    eyebrow: "PHOTO CREDITS",
    sections: [],
  },
};

export default async function PolicyPage({ params }: { params: Promise<{ policy: string }> }) {
  const { policy } = await params;
  const page = pages[policy];
  if (!page) notFound();

  return (
    <main className="policy-page">
      <Link className="wordmark" href="/">
        <VMark size={48} />
        <span>张杰<small>PERSONAL ARCHIVE</small></span>
      </Link>
      <article>
        <p className="eyebrow">{page.eyebrow}</p>
        <h1>{page.title}</h1>
        {page.sections.map(([title, text]) => (
          <section key={title}>
            <h2>{title}</h2>
            <p>{text}</p>
          </section>
        ))}
        {policy === "copyright" && (
          <section id="portrait-credit">
            <h2>首页替补照片</h2>
            <p>
              摄影：<a href="https://commons.wikimedia.org/wiki/User:Twinklestellar" target="_blank" rel="noreferrer">Twinklestellar</a>。作品 <a href="https://commons.wikimedia.org/wiki/File:Zhang_Jie_in_Kuala_Lumpur_(cropped).jpg" target="_blank" rel="noreferrer">Zhang Jie in Kuala Lumpur (cropped)</a> 来自 Wikimedia Commons，采用 <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noreferrer">CC BY-SA 4.0</a> 许可。本站版本经 JPEG 编码与响应式裁剪，改编照片沿用相同许可。
            </p>
          </section>
        )}
        <Link className="button" href="/">回到纪念馆</Link>
      </article>
    </main>
  );
}
