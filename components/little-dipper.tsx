import { useId } from "react";

type LittleDipperProps = {
  size?: number | string;
  className?: string;
  balloons?: boolean;
};

// A vector interpretation of the small, lilac astronaut in the owner's photo.
// The visible side/back pose is retained rather than inventing a mascot face.
export function LittleDipper({ size = 240, className, balloons = true }: LittleDipperProps) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const suit = `dipper-suit-${id}`;
  const head = `dipper-head-${id}`;
  const blue = `dipper-blue-${id}`;
  const foil = `dipper-foil-${id}`;
  const speckles = `dipper-speckles-${id}`;

  return (
    <svg width={size} height={size} viewBox="0 0 320 360" fill="none" className={`little-dipper ${className ?? ""}`.trim()} aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={suit} x1="72" y1="216" x2="218" y2="338" gradientUnits="userSpaceOnUse"><stop stopColor="#eeecfb" /><stop offset=".48" stopColor="#d1c5ed" /><stop offset="1" stopColor="#9a85c0" /></linearGradient>
        <radialGradient id={head} cx="0" cy="0" r="1" gradientTransform="translate(101 155) rotate(63) scale(118 95)" gradientUnits="userSpaceOnUse"><stop stopColor="#faf4ff" /><stop offset=".57" stopColor="#e2d3f5" /><stop offset="1" stopColor="#b39bcf" /></radialGradient>
        <linearGradient id={blue} x1="89" y1="115" x2="142" y2="304" gradientUnits="userSpaceOnUse"><stop stopColor="#308bff" /><stop offset=".5" stopColor="#1b5edb" /><stop offset="1" stopColor="#1842bd" /></linearGradient>
        <radialGradient id={foil} cx="0" cy="0" r="1" gradientTransform="translate(-6 -7) rotate(90) scale(38 39)" gradientUnits="userSpaceOnUse"><stop stopColor="#ecfcff" /><stop offset=".17" stopColor="#8de4ff" /><stop offset=".48" stopColor="#4ba8ee" /><stop offset=".76" stopColor="#145db3" /><stop offset="1" stopColor="#86d9fa" /></radialGradient>
        <pattern id={speckles} width="37" height="43" patternUnits="userSpaceOnUse"><circle cx="8" cy="13" r="3.4" fill="#bfa8da" opacity=".22" /><circle cx="28" cy="33" r="2.6" fill="#bca4d7" opacity=".24" /><circle cx="33" cy="7" r="1.2" fill="#fff" opacity=".6" /><path d="M16 33l3-4 3 2-2 5Z" fill="#c8b4e4" opacity=".22" /></pattern>
      </defs>
      {balloons && <g className="little-dipper-balloons">
        <g stroke="#87d8ff" strokeWidth="1.1" opacity=".74"><path d="M280 124C287 164 264 187 240 214" /><path d="M223 91C234 143 244 181 240 214" /><path d="M280 52C304 111 277 176 240 214" /></g>
        <g transform="translate(270 54) rotate(17)"><path d="M0-34C8-18 13-16 28-14C23-3 19 3 21 20C6 16 2 15-10 27C-17 13-21 9-35 6C-25-6-23-10-23-27C-11-25-7-23 0-34Z" fill={`url(#${foil})`} stroke="#a9e9ff" strokeWidth="1.1" /><path d="M0-29L-5 0L25-12M-5 0L18 17M-5 0L-9 22M-5 0L-31 6M-5 0L-22-23" stroke="#bff5ff" strokeWidth="1" opacity=".74" /><path d="M-20-23C-11-22-7-25-1-30M7-12C12-10 16-10 20-10M-26 3L-11-2" stroke="#f4fdff" strokeWidth="2.2" strokeLinecap="round" /></g>
        <g transform="translate(220 72) rotate(-19) scale(.78)"><path d="M0-34C8-18 13-16 28-14C23-3 19 3 21 20C6 16 2 15-10 27C-17 13-21 9-35 6C-25-6-23-10-23-27C-11-25-7-23 0-34Z" fill={`url(#${foil})`} stroke="#a9e9ff" strokeWidth="1.4" /><path d="M0-29L-5 0L25-12M-5 0L18 17M-5 0L-9 22M-5 0L-31 6M-5 0L-22-23" stroke="#c7f6ff" strokeWidth="1.3" opacity=".7" /><path d="M-20-23C-11-22-7-25-1-30M-26 3L-11-2" stroke="#f4fdff" strokeWidth="2.5" strokeLinecap="round" /></g>
        <g transform="translate(279 109) rotate(4) scale(.76)"><path d="M0-34C8-18 13-16 28-14C23-3 19 3 21 20C6 16 2 15-10 27C-17 13-21 9-35 6C-25-6-23-10-23-27C-11-25-7-23 0-34Z" fill={`url(#${foil})`} stroke="#a9e9ff" strokeWidth="1.4" /><path d="M0-29L-5 0L25-12M-5 0L18 17M-5 0L-9 22M-5 0L-31 6M-5 0L-22-23" stroke="#c7f6ff" strokeWidth="1.3" opacity=".7" /><path d="M-20-23C-11-22-7-25-1-30M-26 3L-11-2" stroke="#f4fdff" strokeWidth="2.5" strokeLinecap="round" /></g>
      </g>}
      <g className="little-dipper-character">
        <ellipse cx="132" cy="340" rx="73" ry="8" fill="#536ab5" opacity=".11" />
        <path d="M125 282C108 295 94 326 96 335C106 343 127 341 140 333L158 304Z" fill={`url(#${suit})`} stroke="#9986bb" strokeWidth="1.3" /><path d="M154 283C167 300 175 323 179 332C187 338 196 338 199 332C199 319 189 297 178 281Z" fill={`url(#${suit})`} stroke="#9986bb" strokeWidth="1.3" />
        <path d="M99 326C97 332 97 338 105 340C117 343 129 340 140 333L134 328" fill="#e2d9f5" stroke="#aa98cb" strokeWidth="1.4" /><path d="M173 329C181 338 197 342 202 335C206 329 197 325 192 325" fill="#dcd1f0" stroke="#aa98cb" strokeWidth="1.4" />
        <path d="M104 224C92 240 87 281 104 301C120 314 166 308 180 290C188 266 179 235 164 224Z" fill={`url(#${suit})`} stroke="#b7a6d0" strokeWidth="1.4" />
        <path d="M115 244C131 254 144 252 161 244M106 270C126 282 149 280 168 271M111 288C128 296 151 292 164 285" stroke="#b3a0cd" strokeWidth="2.3" strokeLinecap="round" opacity=".75" />
        <path d="M106 240C88 234 64 251 63 273C61 291 77 307 96 306C105 291 112 262 106 240Z" fill={`url(#${suit})`} stroke="#b6a3d0" strokeWidth="1.5" /><ellipse cx="79" cy="270" rx="22" ry="24" transform="rotate(15 79 270)" fill="#ece5f9" stroke="#b8a6d5" strokeWidth="3" /><ellipse cx="80" cy="267" rx="14" ry="16" transform="rotate(15 80 267)" fill={`url(#${blue})`} /><path d="M70 258C73 252 82 251 88 256" stroke="#609ef4" strokeWidth="3" strokeLinecap="round" opacity=".85" />
        <path d="M162 237C184 241 212 230 229 215L245 226C221 252 199 265 172 267C163 262 159 247 162 237Z" fill={`url(#${suit})`} stroke="#ab97c6" strokeWidth="1.4" />
        <path d="M184 242L190 258M194 238L201 252M205 234L213 247" stroke="#bbaad4" strokeWidth="2" strokeLinecap="round" /><path d="M224 218L234 231L243 225L234 211Z" fill={`url(#${blue})`} />
        <path d="M233 213C235 205 238 197 244 196C248 196 247 201 245 206C251 200 255 202 252 208C258 205 260 209 255 215C260 212 261 217 254 222L245 228C241 224 237 219 233 213Z" fill="#f0e6f7" stroke="#bda8d4" strokeWidth="1.1" />
        <path d="M103 215L107 235C123 249 148 246 168 232L168 210" fill={`url(#${suit})`} stroke="#b7a1d1" strokeWidth="1.4" /><path d="M102 227C122 239 148 237 169 222" stroke="#eeebf8" strokeWidth="4" />
        <path d="M149 128C116 111 83 125 67 152C49 182 54 218 77 238C103 262 150 255 172 232C191 214 196 187 183 158C177 144 164 134 149 128Z" fill={`url(#${head})`} stroke="#d9c8ec" strokeWidth="1.3" />
        <path d="M149 128C116 111 83 125 67 152C49 182 54 218 77 238C103 262 150 255 172 232C191 214 196 187 183 158C177 144 164 134 149 128Z" fill={`url(#${speckles})`} />
        <path d="M174 162C193 180 191 210 178 228" stroke="#f5efff" strokeWidth="5" opacity=".69" /><path d="M187 172C199 194 195 217 181 232" stroke="#78b4ee" strokeWidth="2" opacity=".54" />
        <ellipse cx="169" cy="224" rx="22" ry="25" transform="rotate(-17 169 224)" fill="#ece3f8" stroke="#c3addb" strokeWidth="2" /><ellipse cx="172" cy="225" rx="13" ry="15" transform="rotate(-17 172 225)" fill={`url(#${blue})`} /><path d="M165 215C170 211 175 213 177 217" stroke="#72b7ff" strokeWidth="2.8" strokeLinecap="round" opacity=".65" />
        <path d="M117 129L101 94C100 88 105 85 109 90L128 121C132 128 123 134 117 129Z" fill={`url(#${blue})`} stroke="#3d91e8" strokeWidth="1.2" /><ellipse cx="103" cy="91" rx="7" ry="5" transform="rotate(-12 103 91)" fill="#4298ec" /><path d="M105 98L119 123" stroke="#82c6ff" strokeWidth="2" strokeLinecap="round" opacity=".65" />
        <path d="M83 143C96 131 110 128 121 130" stroke="#fff" strokeWidth="3.3" strokeLinecap="round" opacity=".5" />
      </g>
    </svg>
  );
}
