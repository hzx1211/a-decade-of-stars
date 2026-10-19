export type NeteaseMusicLink = {id: string; url: string; embedUrl: string};

const MAX_INPUT_LENGTH = 4096;
const MUSIC_ID = /^[1-9]\d{0,19}$/;

function parseIframeSource(value: string): string | null {
  const match = /^\s*<iframe\b([\s\S]*?)>\s*<\/iframe\s*>\s*$/i.exec(value);
  if (!match) return null;

  const attributes = match[1];
  const attributePattern = /\s+([A-Za-z_:][\w:.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/y;
  const seen = new Set<string>();
  let source: string | null = null;
  let position = 0;

  while (position < attributes.length) {
    if (/^\s*$/.test(attributes.slice(position))) break;
    attributePattern.lastIndex = position;
    const attribute = attributePattern.exec(attributes);
    if (!attribute) return null;
    position = attributePattern.lastIndex;

    const name = attribute[1].toLowerCase();
    if (seen.has(name)) return null;
    seen.add(name);
    if (name === "src") {
      source = attribute[2] ?? attribute[3] ?? attribute[4] ?? null;
      if (source === null) return null;
    }
  }

  return source;
}

function parseSecureMusicUrl(value: string, allowProtocolRelative: boolean): URL | null {
  if (!value || /[\\\u0000-\u0020\u007f]/.test(value)) return null;

  let candidate = value;
  if (value.startsWith("//")) {
    if (!allowProtocolRelative || !/^\/\/music\.163\.com(?:[/:?#]|$)/i.test(value)) return null;
    candidate = `https:${value}`;
  } else if (!/^https:\/\//i.test(value)) {
    return null;
  }

  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:" || url.hostname !== "music.163.com" || url.username || url.password || url.port) return null;
    return url;
  } catch {
    return null;
  }
}

function oneParam(url: URL, name: string): string | null {
  const values = url.searchParams.getAll(name);
  return values.length === 1 ? values[0] : null;
}

function validId(value: string | null): value is string {
  return value !== null && MUSIC_ID.test(value);
}

/** Parse an allowed NetEase single-song link into canonical URLs. */
export function parseNeteaseMusic(value: string): NeteaseMusicLink | null {
  if (typeof value !== "string") return null;
  const input = value.trim();
  if (!input || input.length > MAX_INPUT_LENGTH) return null;

  const iframeSource = input.startsWith("<") ? parseIframeSource(input) : null;
  const candidate = iframeSource ?? input;
  const isProtocolRelative = candidate.startsWith("//");
  const url = parseSecureMusicUrl(candidate, isProtocolRelative);
  if (!url) return null;
  if (isProtocolRelative && url.pathname !== "/outchain/player") return null;

  let id: string | null = null;
  if (url.pathname === "/song") {
    id = oneParam(url, "id");
  } else if (url.pathname === "/outchain/player") {
    if (oneParam(url, "type") !== "2") return null;
    id = oneParam(url, "id");
  } else if (url.pathname === "/" && !url.search && url.hash) {
    const route = url.hash.slice(1);
    if (/^\/outchain\/2\/[1-9]\d{0,19}\/?$/.test(route)) {
      id = route.match(/^\/outchain\/2\/([1-9]\d{0,19})\/?$/)?.[1] ?? null;
    } else if (route.startsWith("/song?")) {
      try {
        const hashRoute = new URL(route, "https://music.163.com");
        if (hashRoute.pathname === "/song") id = oneParam(hashRoute, "id");
      } catch {
        return null;
      }
    }
  }

  if (!validId(id)) return null;
  return {
    id,
    url: `https://music.163.com/song?id=${id}`,
    embedUrl: `https://music.163.com/outchain/player?type=2&id=${id}&auto=0&height=66`,
  };
}
