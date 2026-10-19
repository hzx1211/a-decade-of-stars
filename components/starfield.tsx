import { useId } from "react";

export function Starfield({ className = "" }: { className?: string }) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const orbit = `star-orbit-${id}`, glow = `star-glow-${id}`, beam = `star-beam-${id}`;
  return <div className={`star-scene ${className}`} aria-hidden="true">
    <div className="nebula nebula-one" /><div className="nebula nebula-two" />
    <svg className="star-orbit" viewBox="0 0 1100 760" fill="none">
      <defs>
        <linearGradient id={orbit} x1="230" y1="20" x2="970" y2="720"><stop stopColor="#83BCFF" stopOpacity="0"/><stop offset=".42" stopColor="#B4E4FF" stopOpacity=".75"/><stop offset=".82" stopColor="#4B7DFF" stopOpacity=".35"/><stop offset="1" stopColor="#83BCFF" stopOpacity="0"/></linearGradient>
        <radialGradient id={glow}><stop stopColor="#EDF5FF"/><stop offset=".2" stopColor="#B4E4FF" stopOpacity=".85"/><stop offset="1" stopColor="#4B7DFF" stopOpacity="0"/></radialGradient>
        <linearGradient id={beam} x1="0" y1="0" x2="0" y2="1"><stop stopColor="#83BCFF" stopOpacity=".13"/><stop offset="1" stopColor="#4B7DFF" stopOpacity="0"/></linearGradient>
      </defs>
      <g transform="rotate(-28 660 370)">
        <ellipse cx="660" cy="370" rx="422" ry="207" stroke={`url(#${orbit})`} strokeWidth="1.2"/>
        <ellipse cx="660" cy="370" rx="445" ry="221" stroke={`url(#${orbit})`} strokeOpacity=".24" strokeWidth=".7"/>
        <ellipse cx="660" cy="370" rx="469" ry="237" stroke={`url(#${orbit})`} strokeOpacity=".12" strokeWidth=".6"/>
        <path d="M239 358C244 246 433 164 656 163" stroke="#D6EBFF" strokeOpacity=".34" strokeWidth="2"/>
      </g>
      <path d="M772 150L932 695L482 695Z" fill={`url(#${beam})`} opacity=".6"/>
      <path d="M940 280L820 690L1040 690Z" fill={`url(#${beam})`} opacity=".28"/>
      {Array.from({ length: 94 }, (_, i) => {
        const x = (i * 173 + 73) % 1100, y = (i * 127 + 27) % 730;
        return <circle key={i} cx={x} cy={y} r={i % 11 === 0 ? 1.7 : .65} fill={i % 7 === 0 ? "#83BCFF" : "#B4E4FF"} opacity={.15 + (i % 5) * .12} className={i % 11 === 0 ? "twinkle" : ""} style={{ animationDelay: `${i % 8}s` }}/>;
      })}
      <circle cx="784" cy="147" r="43" fill={`url(#${glow})`} opacity=".6"/>
      <path d="M784 133L786 145L798 147L786 149L784 161L782 149L770 147L782 145Z" fill="#EDF5FF"/>
      <circle cx="366" cy="552" r="20" fill={`url(#${glow})`} opacity=".4"/>
      <circle cx="366" cy="552" r="1.9" fill="#E6EFFC"/>
      <path d="M650 665Q840 649 1090 665" stroke="#B9DDFC" strokeOpacity=".08"/>
      <path d="M650 679Q840 667 1090 679" stroke="#B9DDFC" strokeOpacity=".06"/>
    </svg>
    <div className="star-grain"/>
  </div>;
}
export function StarMark({ size = 28 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M16 2L19 13L30 16L19 19L16 30L13 19L2 16L13 13L16 2Z" stroke="currentColor" strokeWidth=".9"/><path d="M16 9L17.5 14.5L23 16L17.5 17.5L16 23L14.5 17.5L9 16L14.5 14.5L16 9Z" fill="currentColor"/></svg>;
}
