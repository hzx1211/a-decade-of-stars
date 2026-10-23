"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, ViewTransition, type KeyboardEvent, type ReactNode, type Ref } from "react";
import { AnimatePresence, LayoutGroup, motion, useIsPresent } from "motion/react";
import { Search, Menu, X, ArrowUpRight, LogOut, LogIn, Settings, ChevronDown, LoaderCircle } from "lucide-react";
import { VMark } from "./v-mark";
import { GlassLayers } from "./liquid-glass-effects";
import { StarseaBackdrop } from "./starsea-backdrop";
import { MusicLibrary } from "./music-library";
import { MotionPage, MotionPresence, MotionScope, SharedArtwork, useMotionPreference } from "./motion";
import type { Asset, Entry, SiteSettings } from "@/lib/types";
import "./navigation.css";

type NavItem = readonly [href: string, label: string];
type CollectionGroup = { title: string; english: string; items: readonly NavItem[] };
const primary: readonly NavItem[] = [
  ["/app/dashboard", "纪念馆首页"], ["/app/journey", "我的星途"],
  ["/app/music", "音乐馆"], ["/app/videos", "影像馆"], ["/app/photos", "照片馆"],
];
const collectionGroups: readonly CollectionGroup[] = [
  { title: "音乐与现场", english: "MUSIC & STAGE", items: [["/app/albums", "专辑馆"], ["/app/concerts", "演唱会回忆"], ["/app/archive", "综合典藏馆"]] },
  { title: "写下的热爱", english: "WORDS & MEMORIES", items: [["/app/journal", "追星日记"], ["/app/letters", "写给张杰的信"], ["/app/memory-book", "十余年纪念册"]] },
  { title: "时间与星途", english: "TIME & CONSTELLATIONS", items: [["/app/timeline", "时光长廊"], ["/app/calendar", "纪念日历"], ["/app/star-map", "我的追星星系"]] },
];
const secondary: readonly NavItem[] = [...collectionGroups.flatMap(group => group.items), ["/app/admin", "内容管理"]];
const ease = [0.22, 1, 0.36, 1] as const;
const isActive = (path: string, href: string) => path === href || (href !== "/app/dashboard" && path.startsWith(`${href}/`));

function NavSelection({ id }: { id: string }) {
  const enabled = useMotionPreference();
  return <motion.span className="nav-active-line" aria-hidden="true" data-motion-managed layoutId={enabled ? id : undefined} initial={enabled ? { opacity: 0 } : false} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: enabled ? 0.3 : 0, ease }} />;
}

function NavigationIcon({ changed, ready, active }: { changed: boolean; ready: ReactNode; active: ReactNode }) {
  const enabled = useMotionPreference();
  return <span className="nav-icon-switch" data-motion-managed aria-hidden="true"><motion.span className="nav-icon-layer" initial={false} animate={{ opacity: changed ? 0 : 1, rotate: changed ? -30 : 0, scale: changed ? 0.8 : 1 }} transition={{ duration: enabled ? 0.18 : 0, ease }}>{ready}</motion.span><motion.span className="nav-icon-layer" initial={false} animate={{ opacity: changed ? 1 : 0, rotate: changed ? 0 : 30, scale: changed ? 1 : 0.8 }} transition={{ duration: enabled ? 0.18 : 0, ease }}>{active}</motion.span></span>;
}

function navigateWithArrows(event: KeyboardEvent<HTMLElement>) {
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  const links = Array.from(event.currentTarget.querySelectorAll<HTMLAnchorElement>("a[href]"));
  if (!links.length) return;
  event.preventDefault();
  const current = links.findIndex(link => link === document.activeElement);
  const next = event.key === "Home" ? 0 : event.key === "End" ? links.length - 1 : (current + (event.key === "ArrowUp" ? -1 : 1) + links.length) % links.length;
  links[next]?.focus();
}

function CollectionLink({ href, label, path, onNavigate }: { href: string; label: string; path: string; onNavigate: () => void }) {
  return <Link href={href} onClick={onNavigate} className={isActive(path, href) ? "active" : ""} aria-current={isActive(path, href) ? "page" : undefined}><span>{label}</span><ArrowUpRight size={14} aria-hidden="true" /></Link>;
}

function MoreNavigation({ path, onNavigate, menuRef, readOnly }: { path: string; onNavigate: () => void; menuRef: Ref<HTMLDivElement>; readOnly: boolean }) {
  const present = useIsPresent(), enabled = useMotionPreference();
  return <motion.div ref={menuRef} id="archive-more-navigation" className="nav-dropdown" aria-hidden={!present} inert={!present} data-motion-managed onKeyDown={navigateWithArrows}
    initial={enabled ? { opacity: 0, y: -6, scale: 0.985 } : false} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6, scale: 0.985 }} transition={{ duration: enabled ? 0.2 : 0, ease }} data-state={present ? "open" : "closing"}>
    <div className="collection-menu-heading"><span>热爱 自成宇宙</span><span><i aria-hidden="true" /> EXPLORE YOUR UNIVERSE</span></div>
    <nav className="collection-menu-grid" aria-label="珍藏导航">{collectionGroups.map((group, index) => <div className="collection-menu-group" key={group.title}><h2><span className="collection-group-number" aria-hidden="true">0{index + 1}</span>{group.title}<small>{group.english}</small></h2>{group.items.map(([href, label]) => <CollectionLink key={href} href={href} label={label} path={path} onNavigate={onNavigate} />)}</div>)}</nav>
    <div className="collection-menu-bottom"><span>从一束蓝光 到整片星海</span>{!readOnly && <CollectionLink href="/app/admin" label="内容管理" path={path} onNavigate={onNavigate} />}</div>
    <GlassLayers />
  </motion.div>;
}

function MobileNavigation({ path, onNavigate, menuRef, readOnly }: { path: string; onNavigate: () => void; menuRef: Ref<HTMLDivElement>; readOnly: boolean }) {
  const present = useIsPresent(), enabled = useMotionPreference();
  return <motion.div ref={menuRef} className="mobile-nav-presence" aria-hidden={!present} inert={!present} data-motion-managed
    initial={enabled ? { height: 0, opacity: 0 } : false} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: enabled ? 0.25 : 0, ease }} data-state={present ? "open" : "closing"}>
    <nav id="archive-mobile-navigation" className="mobile-nav" aria-label="移动端导航" onKeyDown={navigateWithArrows}>
      <div className="mobile-primary-links">{primary.map(([href, label]) => <Link href={href} key={href} onClick={onNavigate} className={isActive(path, href) ? "active" : ""} aria-current={isActive(path, href) ? "page" : undefined}><span>{label}</span><ArrowUpRight size={15} aria-hidden="true" /><AnimatePresence initial={false}>{isActive(path, href) && <NavSelection id="mobile-navigation-selection" />}</AnimatePresence></Link>)}</div>
      <div className="mobile-collection-groups">{collectionGroups.map(group => <div className="mobile-collection-group" key={group.title}><h2>{group.title}<small>{group.english}</small></h2><div>{group.items.map(([href, label]) => <CollectionLink key={href} href={href} label={label} path={path} onNavigate={onNavigate} />)}</div></div>)}</div>
      <div className="mobile-navigation-utilities">{readOnly ? <CollectionLink href="/login" label="所有者登录" path={path} onNavigate={onNavigate} /> : <><CollectionLink href="/app/admin" label="内容管理" path={path} onNavigate={onNavigate} /><CollectionLink href="/app/settings" label="网站设置" path={path} onNavigate={onNavigate} /></>}</div>
      <GlassLayers />
    </nav>
  </motion.div>;
}

export function Shell({ children, settings, initialEntries = [], initialAssets = [], readOnly = false }: { children: ReactNode; settings: SiteSettings; initialEntries?: Entry[]; initialAssets?: Asset[]; readOnly?: boolean }) {
  return <MotionScope enabled={settings.animation}><MusicLibrary readOnly={readOnly} initialEntries={initialEntries} initialAssets={initialAssets}><ShellFrame settings={settings} readOnly={readOnly}>{children}</ShellFrame></MusicLibrary></MotionScope>;
}

function ShellFrame({ children, settings, readOnly }: { children: ReactNode; settings: SiteSettings; readOnly: boolean }) {
  const path = usePathname(), router = useRouter(), navigationId = useId();
  const enabled = useMotionPreference();
  const [open, setOpen] = useState(false), [more, setMore] = useState(false), [error, setError] = useState(""), [loggingOut, setLoggingOut] = useState(false);
  const site = useRef<HTMLDivElement>(null);
  const header = useRef<HTMLElement>(null), moreContainer = useRef<HTMLDivElement>(null), moreToggle = useRef<HTMLButtonElement>(null), mobileToggle = useRef<HTMLButtonElement>(null);
  const moreMenu = useRef<HTMLDivElement>(null), mobileMenu = useRef<HTMLDivElement>(null), focusOnOpen = useRef<"first" | "last" | null>(null);

  useEffect(() => {
    const scene = site.current;
    const visibility = () => scene?.toggleAttribute("data-page-hidden", document.hidden);
    visibility();
    document.addEventListener("visibilitychange", visibility);
    return () => document.removeEventListener("visibilitychange", visibility);
  }, []);

  useEffect(() => {
    if ((!open && !more) || !focusOnOpen.current) return;
    const position = focusOnOpen.current;
    focusOnOpen.current = null;
    const frame = requestAnimationFrame(() => {
      const links = (more ? moreMenu : mobileMenu).current?.querySelectorAll<HTMLAnchorElement>("a[href]");
      links?.[position === "last" ? links.length - 1 : 0]?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [open, more]);

  useEffect(() => {
    if (!open && !more) return;
    const outside = (event: PointerEvent | FocusEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (more && !moreContainer.current?.contains(target)) setMore(false);
      if (open && !header.current?.contains(target)) setOpen(false);
    };
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (more) { setMore(false); moreToggle.current?.focus(); }
      if (open) { setOpen(false); mobileToggle.current?.focus(); }
    };
    const closeOnHistory = () => { setOpen(false); setMore(false); };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    document.addEventListener("keydown", escape);
    window.addEventListener("popstate", closeOnHistory);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("focusin", outside); document.removeEventListener("keydown", escape); window.removeEventListener("popstate", closeOnHistory); };
  }, [open, more]);

  async function logout() {
    if (loggingOut) return;
    setLoggingOut(true); setError("");
    try { const response = await fetch("/api/auth/logout", { method: "POST" }); if (!response.ok) throw new Error("退出失败，请重试"); router.push("/login"); router.refresh(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "退出失败"); setLoggingOut(false); }
  }
  function closeNavigation() { setOpen(false); setMore(false); }
  function openWithKeyboard(event: KeyboardEvent<HTMLButtonElement>, menu: "more" | "mobile") {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    if ((menu === "more" && more) || (menu === "mobile" && open)) {
      const links = (menu === "more" ? moreMenu : mobileMenu).current?.querySelectorAll<HTMLAnchorElement>("a[href]");
      links?.[event.key === "ArrowUp" ? links.length - 1 : 0]?.focus();
      return;
    }
    focusOnOpen.current = event.key === "ArrowUp" ? "last" : "first";
    if (menu === "more") { setOpen(false); setMore(true); }
    else { setMore(false); setOpen(true); }
  }

  return <div ref={site} className={`site stage-site starsea-site ${!settings.animation ? "no-animation" : ""} theme-${settings.theme}`}>
    <StarseaBackdrop key={readOnly ? "visitor" : "owner"} privateMediaEnabled={!readOnly} />
    <a href="#main-content" className="skip-link">跳到主要内容</a>
    <LayoutGroup id={navigationId}><ViewTransition name="archive-header" default="none"><header className="site-header archive-navigation" ref={header}><div className="nav-inner">
      <Link href="/app/dashboard" className="wordmark stage-wordmark" onClick={closeNavigation} aria-label="张杰纪念馆首页"><SharedArtwork name="archive-logo"><VMark size={46} /></SharedArtwork><span>张杰<small>{readOnly ? "蓝色星海 · 精选珍藏" : "蓝色星海 · 私人典藏"}</small></span></Link>
      <nav className="desktop-nav" aria-label="主导航">{primary.map(([href, label]) => <Link key={href} href={href} onClick={closeNavigation} className={isActive(path, href) ? "active" : ""} aria-current={isActive(path, href) ? "page" : undefined}>{label}<AnimatePresence initial={false}>{isActive(path, href) && <NavSelection id="archive-nav-indicator" />}</AnimatePresence></Link>)}
        <div className="more-nav" ref={moreContainer}><button ref={moreToggle} onKeyDown={event => openWithKeyboard(event, "more")} onClick={event => { focusOnOpen.current = event.detail === 0 && !more ? "first" : null; setOpen(false); setMore(value => !value); }} aria-label="更多珍藏" aria-expanded={more} aria-controls="archive-more-navigation" className={secondary.some(([href]) => isActive(path, href)) ? "active" : ""}>更多珍藏 <motion.span className="nav-chevron" aria-hidden="true" animate={{ rotate: more ? 180 : 0 }} transition={{ duration: enabled ? 0.2 : 0, ease }}><ChevronDown size={13} /></motion.span><AnimatePresence initial={false}>{secondary.some(([href]) => isActive(path, href)) && <NavSelection id="archive-nav-indicator" />}</AnimatePresence></button><AnimatePresence>{more && <MoreNavigation path={path} onNavigate={closeNavigation} menuRef={moreMenu} readOnly={readOnly} />}</AnimatePresence></div>
      </nav>
      <div className="nav-actions"><Link href="/app/search" className="icon-button nav-search" aria-label="搜索珍藏" onClick={closeNavigation} aria-current={isActive(path, "/app/search") ? "page" : undefined}><Search size={18} /><span aria-hidden="true">搜索</span></Link><span className="nav-utility-rule" aria-hidden="true" />{readOnly ? <Link href="/login" className="icon-button owner-login" aria-label="所有者登录" title="所有者登录" onClick={closeNavigation}><LogIn size={18} /><span aria-hidden="true">登录</span></Link> : <><Link href="/app/settings" className="icon-button settings-link" aria-label="网站设置" title="网站设置" onClick={closeNavigation} aria-current={isActive(path, "/app/settings") ? "page" : undefined}><Settings size={18} /></Link><button className="icon-button logout-button" onClick={() => void logout()} disabled={loggingOut} title="退出登录" aria-label={loggingOut ? "正在退出登录" : "退出登录"} aria-busy={loggingOut}><NavigationIcon changed={loggingOut} ready={<LogOut size={17} />} active={<LoaderCircle size={17} className={loggingOut ? "ws-spin" : ""} />} /></button></>}<button ref={mobileToggle} className="icon-button mobile-toggle" onKeyDown={event => openWithKeyboard(event, "mobile")} onClick={event => { focusOnOpen.current = event.detail === 0 && !open ? "first" : null; setMore(false); setOpen(value => !value); }} aria-label={open ? "关闭菜单" : "打开菜单"} aria-expanded={open} aria-controls="archive-mobile-navigation"><NavigationIcon changed={open} ready={<Menu size={21} />} active={<X size={21} />} /></button></div>
    </div><AnimatePresence>{open && <MobileNavigation path={path} onNavigate={closeNavigation} menuRef={mobileMenu} readOnly={readOnly} />}</AnimatePresence><GlassLayers /></header></ViewTransition></LayoutGroup>
    <MotionPresence show={!!error} className="shell-error-presence"><div role="alert" className="shell-error">{error}</div></MotionPresence>
    <main id="main-content"><MotionPage>{children}</MotionPage></main><Footer startYear={settings.startYear} />
    <div className="archive-modal-layer" data-modal-root />
  </div>;
}

export function Footer({ startYear = 2009 }: { startYear?: number | null }) {
  return <footer className="site-footer stage-footer archive-footer">
    <div className="footer-top">
      <Link href="/app/dashboard" className="footer-brand" aria-label="回到纪念馆首页">
        <VMark size={44} />
        <span><strong>张杰勇敢飞 星星永相随</strong><small>PERSONAL ARCHIVE · 私人纪念馆</small></span>
      </Link>
      <span className="footer-since">{startYear ? `${startYear} — ${new Date().getFullYear()}` : ""}<small>每一份热爱 亲手珍藏</small></span>
    </div>
  </footer>;
}
