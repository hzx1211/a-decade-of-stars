import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { ArrowUpRight, ArrowRight, Music2, Play, Camera, Feather, CalendarDays, Plus } from "lucide-react";
import { kindLabels, type Entry, type SiteSettings } from "@/lib/types";
import { VMark } from "./v-mark";
import { LittleDipper } from "./little-dipper";
import { SharedArtwork } from "./motion";
import { FanPortrait } from "./fan-portrait";
import { GlassLayers } from "./liquid-glass-effects";

const modules = {
  music: { english: "MUSIC", title: "音乐馆", empty: "留下一首想反复听的歌。", icon: Music2, action: "打开音乐馆", first: "收录第一首歌" },
  videos: { english: "ON STAGE", title: "影像馆", empty: "收藏一段值得重温的影像。", icon: Play, action: "打开影像馆", first: "收录第一段影像" },
  photos: { english: "IN FRAME", title: "照片馆", empty: "让喜欢的照片，有一个位置。", icon: Camera, action: "打开照片馆", first: "收录第一张照片" },
  journal: { english: "MY WORDS", title: "追星日记", empty: "写下歌声之外，自己的生活。", icon: Feather, action: "打开日记", first: "写下第一篇日记" },
  concerts: { english: "LIVE MEMORIES", title: "演唱会回忆", empty: "把属于自己的现场记忆写下来。", icon: CalendarDays, action: "打开演唱会回忆", first: "记录一次相见" },
};

function entryImage(entry: Entry) {
  return entry.data.coverAssetId || (entry.kind === "photos" ? entry.data.assetId : undefined);
}

export function Dashboard({ entries, settings, themeMediaAvailable = false, beidouMediaAvailable = themeMediaAvailable }: { entries: Entry[]; settings: SiteSettings; themeMediaAvailable?: boolean; beidouMediaAvailable?: boolean }) {
  const currentYear = Number(new Intl.DateTimeFormat("en", { year: "numeric", timeZone: settings.timezone }).format(new Date()));
  const start = settings.startYear;
  const togetherYears = start == null ? null : Math.max(0, currentYear - start);
  const heroImage = settings.heroAssetId ? `/api/assets/${settings.heroAssetId}` : "/api/artist-portrait";
  const mobileHeroImage = settings.mobileHeroAssetId ? `/api/assets/${settings.mobileHeroAssetId}` : heroImage;
  const heroStyle = { "--concert-photo-position": settings.heroPosition } as CSSProperties;
  const journeyEntries = entries.filter((entry) => entry.kind === "journey").sort((a, b) => (a.data.year ?? 0) - (b.data.year ?? 0));
  let chapterNumber = 0;
  const number = () => String(++chapterNumber).padStart(2, "0");

  function journey() {
    const chapter = number();
    return <section className="concert-journey liquid-glass" key="journey" aria-labelledby="concert-journey-title">
      <div className="concert-section-heading">
        <div><p className="concert-kicker"><span>{chapter}</span> THE YEARS / 我的星途</p><h2 id="concert-journey-title">热爱，从这里开始。</h2></div>
        <Link href="/app/journey" className="concert-inline-link">回望我的星途 <ArrowUpRight size={18} /></Link>
      </div>
      <div className="concert-years">
        <svg className="concert-year-ribbon" viewBox="0 0 1200 260" preserveAspectRatio="none" aria-hidden="true" focusable="false">
          <defs>
            <linearGradient id="journey-ribbon-material" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#e6f7ff" stopOpacity=".38" />
              <stop offset=".48" stopColor="#7cbfff" stopOpacity=".2" />
              <stop offset="1" stopColor="#679fff" stopOpacity=".04" />
            </linearGradient>
            <linearGradient id="journey-ribbon-light">
              <stop stopColor="#91caff" stopOpacity="0" />
              <stop offset=".28" stopColor="#a8ddff" stopOpacity=".45" />
              <stop offset=".52" stopColor="#effbff" stopOpacity=".9" />
              <stop offset=".76" stopColor="#a8ddff" stopOpacity=".45" />
              <stop offset="1" stopColor="#91caff" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="journey-ribbon-fade">
              <stop stopColor="white" stopOpacity="0" />
              <stop offset=".13" stopColor="white" />
              <stop offset=".87" stopColor="white" />
              <stop offset="1" stopColor="white" stopOpacity="0" />
            </linearGradient>
            <mask id="journey-ribbon-mask"><rect width="1200" height="260" fill="url(#journey-ribbon-fade)" /></mask>
            <filter id="journey-ribbon-bloom" x="-20%" y="-100%" width="140%" height="300%"><feGaussianBlur stdDeviation="12" /></filter>
          </defs>
          <g mask="url(#journey-ribbon-mask)">
            <path d="M0 183 C190 246 330 186 450 136 C560 90 620 95 740 141 C900 205 1020 227 1200 173" fill="none" stroke="#85baff" strokeWidth="24" opacity=".23" filter="url(#journey-ribbon-bloom)" />
            <path d="M0 168 C190 231 330 171 450 121 C560 75 620 80 740 126 C900 190 1020 212 1200 158 L1200 188 C1020 242 900 220 740 156 C620 110 560 105 450 151 C330 201 190 261 0 198 Z" fill="url(#journey-ribbon-material)" />
            <path d="M0 168 C190 231 330 171 450 121 C560 75 620 80 740 126 C900 190 1020 212 1200 158" fill="none" stroke="url(#journey-ribbon-light)" strokeWidth="1.8" />
            <path d="M0 198 C190 261 330 201 450 151 C560 105 620 110 740 156 C900 220 1020 242 1200 188" fill="none" stroke="url(#journey-ribbon-light)" strokeWidth=".8" opacity=".4" />
            <path className="concert-year-current-light" d="M0 181 C190 244 330 184 450 134 C560 88 620 93 740 139 C900 203 1020 225 1200 171" fill="none" stroke="#e2f6ff" strokeWidth="4" strokeLinecap="round" pathLength="1000" strokeDasharray="2 998" />
          </g>
          <g className="concert-year-constellation" fill="#d8f1ff">
            <circle cx="120" cy="205" r="1.8" />
            <path d="M210 209 v8 M206 213 h8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
            <circle cx="310" cy="194" r="2.4" />
            <circle cx="385" cy="171" r="1.6" />
            <path d="M458 130 v10 M453 135 h10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
            <circle cx="738" cy="148" r="2" />
            <path d="M812 167 v10 M807 172 h10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
            <circle cx="892" cy="197" r="2.5" />
            <circle cx="980" cy="207" r="1.6" />
            <path d="M1065 196 v8 M1061 200 h8" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
            <circle cx="1120" cy="192" r="1.8" />
          </g>
        </svg>
        <div className="concert-year"><strong>{start ?? "起点"}</strong><span>{start ? "热爱的起始年" : "填写热爱的起点"}</span></div>
        <Link href="/app/journey" className="concert-year-passage" aria-label={togetherYears == null ? "继续我的星途" : `相伴 ${togetherYears} 年，继续我的星途`}>
          <span className="concert-year-duration">{togetherYears == null ? "下一段星光" : <>相伴 <strong>{togetherYears}</strong> 年</>}</span>
          <span className="concert-year-glass" aria-hidden="true"><ArrowRight size={27} strokeWidth={1.7} /></span>
          <span className="concert-year-invitation">继续我的星途</span>
        </Link>
        <div className="concert-year concert-year-current"><strong>{currentYear}</strong><span>故事仍在继续</span></div>
      </div>
      <div className="concert-journey-memories">
        {journeyEntries.length > 0 ? <><p className="concert-journey-caption">时光里的坐标</p><div className="concert-year-nodes">{journeyEntries.slice(0, 3).map((entry) => <Link key={entry.id} href={`/app/journey/${entry.id}`}><span className="concert-node-dot" aria-hidden="true" /><span className="concert-memory-copy"><span>{entry.data.year === start ? "起点" : entry.data.year ?? "一段记忆"}</span><strong>{entry.title}</strong></span><ArrowUpRight size={16} /></Link>)}</div></> : <Link href="/app/journey" className="concert-first-memory"><Plus size={16} /><span>写下第一段星途记忆</span><ArrowUpRight size={16} /></Link>}
      </div>
      <GlassLayers />
    </section>;
  }

  function media(key: keyof typeof modules) {
    const collection = modules[key], Icon = collection.icon;
    const all = entries.filter((entry) => entry.kind === key);
    const selected = all.filter((entry) => settings.featuredIds.includes(entry.id) || entry.data.featured || entry.favorite);
    const shown = (selected.length ? selected : all).slice(0, 3);
    const chapter = number();
    return <section className={`concert-chapter concert-chapter-${key} liquid-glass ${shown.length ? "concert-chapter-filled" : ""}`} key={key} aria-labelledby={`concert-chapter-${key}`}>
      <div className="concert-chapter-label">
        <span className="concert-chapter-symbol" aria-hidden="true"><Icon size={21} strokeWidth={1.5} /></span>
        <div><p className="concert-kicker"><span>{chapter}</span>{collection.english}</p><h3 id={`concert-chapter-${key}`}>{collection.title}</h3></div>
        <span className="concert-chapter-count">{String(all.length).padStart(2, "0")}<span>份珍藏</span></span>
      </div>
      {shown.length ? <div className={`concert-selection ${key === "photos" ? "concert-photo-selection" : ""}`}>
        {shown.map((entry) => {
          const image = entryImage(entry);
          return <Link key={entry.id} href={`/app/${entry.kind}/${entry.id}`} className="concert-entry">
            {image ? <img src={`/api/assets/${image}`} alt={entry.title} loading="lazy" /> : <span className="concert-entry-icon"><Icon size={22} strokeWidth={1.5} /></span>}
            <div><strong>{entry.title}</strong><span>{entry.data.year || entry.data.date || kindLabels[entry.kind]}</span></div>
            <ArrowUpRight className="concert-entry-arrow" size={16} />
          </Link>;
        })}
      </div> : <div className="concert-chapter-empty"><span className="concert-empty-symbol" aria-hidden="true"><Icon size={37} strokeWidth={1} /></span><p><span>等待下一份珍藏</span>{collection.empty}</p></div>}
      <Link href={`/app/${key}`} className="concert-chapter-link">{shown.length ? collection.action : collection.first}<ArrowUpRight size={18} /></Link>
      <GlassLayers />
    </section>;
  }

  function starMap() {
    const chapter = number();
    return <section className="concert-star-map liquid-glass" key="star-map" aria-labelledby="concert-beidou-title">
      <div className="concert-beidou-copy"><p className="concert-kicker"><span>{chapter}</span> LITTLE DIPPER / 小北斗</p><h2 id="concert-beidou-title">小北斗，陪热爱继续。</h2><p>给每一份歌曲、影像与文字，<br />留一个能再次相遇的坐标。</p><Link href="/app/star-map" className="concert-inline-link">打开我的星系 <ArrowUpRight size={20} /></Link><div className="concert-beidou-mascot"><LittleDipper className="concert-little-dipper" size={138} /><span className="concert-foil-star concert-foil-star-one" /><span className="concert-foil-star concert-foil-star-two" /></div></div>
      {beidouMediaAvailable ? <figure className="concert-beidou-photo"><Link href="/api/theme-media/beidou" target="_blank" rel="noopener noreferrer" aria-label="查看小北斗现场原图"><img src="/api/theme-media/beidou" alt="张杰与小北斗牵手、提着行李箱的现场照片" loading="lazy" /></Link><figcaption><Link href="/api/theme-media/beidou" target="_blank" rel="noopener noreferrer">查看全图 <ArrowUpRight size={14} /></Link></figcaption></figure> : <div className="concert-beidou-lettering" aria-hidden="true"><span>LITTLE</span><span>DIPPER<span className="concert-foil-star" /></span><p>每一段热爱，都有自己的星系。</p></div>}
      <GlassLayers />
    </section>;
  }

  const sections: ReactNode[] = [];
  let group: ReactNode[] = [];
  function flush() {
    if (!group.length) return;
    sections.push(<section className="concert-repertoire" key={`repertoire-${sections.length}`} aria-label="珍藏目录"><div className="concert-repertoire-heading"><div><p className="concert-kicker">THE PRIVATE COLLECTION</p><h2>我的珍藏</h2></div><p>把喜欢的瞬间，留在这里</p></div><div className="concert-collection-grid">{group}</div></section>);
    group = [];
  }
  for (const key of settings.moduleOrder.filter((key) => !settings.hiddenModules.includes(key))) {
    if (key in modules) group.push(media(key as keyof typeof modules));
    else {
      flush();
      if (key === "journey") sections.push(journey());
      if (key === "star-map") sections.push(starMap());
    }
  }
  flush();

  return <div className="concert-dashboard">
    <section className={`concert-hero ${themeMediaAvailable ? "concert-hero-reference" : ""}`} aria-labelledby="concert-artist-name" style={heroStyle}>
      <div className="concert-hero-meta"><p>{settings.siteName}<span>THE PRIVATE ARCHIVE</span></p><span>{start ?? "起点待填写"} — {currentYear}</span></div>
      <div className="concert-hero-content">
        <div className="concert-hero-insignia"><SharedArtwork name="archive-v"><VMark className="concert-hero-v" size={200} /></SharedArtwork></div>
        <p className="concert-archive-name">歌声有回响 热爱有归处</p>
        <h1 id="concert-artist-name">张杰<span>JASON ZHANG</span></h1>
        <div className="concert-hero-copy"><p className="concert-motto">张杰勇敢飞，<br />星星永相随。</p><p className="concert-subtitle">{settings.subtitle}</p></div>
        <div className="concert-hero-actions"><Link href="/app/journey" className="concert-primary-link">打开我的星途 <ArrowUpRight size={20} /></Link><Link href="/app/music" className="concert-secondary-link">走进音乐馆 <ArrowRight size={17} /></Link></div>
      </div>
      <figure className={`concert-portrait ${settings.heroAssetId ? "concert-portrait-custom" : "concert-portrait-default"} ${settings.mobileHeroAssetId ? "concert-mobile-custom" : ""}`}>
        <div className="concert-portrait-label"><span>THE MOMENT IN LIGHT</span><span>星光入扇</span></div>
        <div className="concert-portrait-frame"><FanPortrait key={`${heroImage}-${mobileHeroImage}`} src={heroImage} mobileSrc={mobileHeroImage} alt={settings.heroAssetId || settings.mobileHeroAssetId ? "首页珍藏照片" : themeMediaAvailable ? "张杰与小北斗牵手走在星雨中的现场照片" : "张杰本人照片"} /></div>
        <figcaption>{settings.heroAssetId || themeMediaAvailable ? <Link href={heroImage} target="_blank" rel="noopener noreferrer" className={settings.mobileHeroAssetId ? "concert-portrait-credit concert-desktop-credit" : "concert-portrait-credit"}>查看完整照片<ArrowUpRight size={12} /></Link> : <Link href="/copyright" className={settings.mobileHeroAssetId ? "concert-portrait-credit concert-desktop-credit" : "concert-portrait-credit"}>摄影 Twinklestellar · CC BY-SA 4.0<ArrowUpRight size={12} /></Link>}{settings.mobileHeroAssetId && <Link href={mobileHeroImage} target="_blank" rel="noopener noreferrer" className="concert-portrait-credit concert-mobile-credit">查看完整照片<ArrowUpRight size={12} /></Link>}</figcaption>
      </figure>
      <div className="concert-hero-footer"><div className="concert-since"><span>SINCE</span><strong>{start ?? "—"}</strong><span>把热爱慢慢收藏</span></div><p>歌声 · 现场 · 时光 · 我</p><Link href="/app/settings#home-visual">更换首页照片 <ArrowUpRight size={13} /></Link></div>
    </section>
    <div className="concert-content">{sections}<section className="concert-letter liquid-glass"><Feather size={21} strokeWidth={1.4} /><div><p>有些话，想一直写给你。</p><span>LETTERS TO ZHANG JIE</span></div><Link href="/app/letters">打开我的信笺 <ArrowRight size={18} /></Link><GlassLayers /></section></div>
  </div>;
}
