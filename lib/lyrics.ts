export type LyricLine = {time: number | null; text: string};

const MAX_SOURCE_LENGTH = 100_000;
const MAX_CUES = 10_000;
const MAX_EXPANDED_TEXT_LENGTH = 1_000_000;
const MAX_OFFSET_MS = 600_000;
const metadataTag = /^(?:ar|al|ti|au|by|re|ve|length|tool|id)\s*:/i;
const timestampTag = /^(\d{1,6}):([0-5]\d)(?:[.:](\d{1,9}))?$/;

/**
 * Parse local LRC or plain text without treating its content as markup.
 * LRC offsets are milliseconds: a positive offset makes a cue appear earlier.
 * The last valid offset applies to every cue, even when its tag follows lyrics.
 * Source, cue count and expanded text are bounded for pasted/untrusted files.
 */
export function parseLyrics(source: string): {lines: LyricLine[]; synced: boolean} {
  const sourceLines = source.slice(0, MAX_SOURCE_LENGTH).replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n");
  const plain: LyricLine[] = [];
  const cues: {time: number; text: string}[] = [];
  let offset = 0;
  let expandedLength = 0;

  for (const sourceLine of sourceLines) {
    const line = sourceLine.trim();
    if (!line) continue;
    const times = new Set<number>();
    const literalTags: string[] = [];
    let cursor = 0;
    let hadMetadata = false;

    while (line[cursor] === "[") {
      const end = line.indexOf("]", cursor + 1);
      if (end === -1) break;
      const tag = line.slice(cursor + 1, end).trim();
      const timestamp = timestampTag.exec(tag);
      if (timestamp) {
        times.add(Number(timestamp[1]) * 60 + Number(timestamp[2]) + (timestamp[3] ? Number(`0.${timestamp[3]}`) : 0));
      } else if (/^offset\s*:/i.test(tag)) {
        hadMetadata = true;
        const value = tag.replace(/^offset\s*:/i, "").trim();
        if (/^[+-]?\d+$/.test(value)) {
          const milliseconds = Number(value);
          if (Number.isSafeInteger(milliseconds) && Math.abs(milliseconds) <= MAX_OFFSET_MS) offset = milliseconds;
        }
      } else if (metadataTag.test(tag)) {
        hadMetadata = true;
      } else {
        literalTags.push(line.slice(cursor, end + 1));
      }
      cursor = end + 1;
      while (line[cursor] === " " || line[cursor] === "\t") cursor++;
    }

    const text = `${literalTags.join("")}${line.slice(cursor)}`.trim();
    if (!times.size) {
      if (plain.length < MAX_CUES && text && (!hadMetadata || cursor < line.length)) plain.push({time: null, text});
      continue;
    }
    for (const time of times) {
      if (cues.length >= MAX_CUES || expandedLength + text.length > MAX_EXPANDED_TEXT_LENGTH) break;
      cues.push({time, text});
      expandedLength += text.length;
    }
  }

  if (!cues.length) return {lines: plain, synced: false};
  cues.sort((a, b) => a.time - b.time);
  const lines: LyricLine[] = [];
  let groupTime: number | undefined;
  let groupTexts = new Set<string>();
  const finishGroup = () => {
    if (groupTime !== undefined) lines.push({time: groupTime - offset / 1_000, text: [...groupTexts].join("\n")});
  };
  for (const cue of cues) {
    if (cue.time !== groupTime) {
      finishGroup();
      groupTime = cue.time;
      groupTexts = new Set<string>();
    }
    // Duplicate timestamps often carry a translation; keep distinct nonempty lines.
    if (cue.text) groupTexts.add(cue.text);
  }
  finishGroup();
  return {lines, synced: true};
}

/**
 * Find the current cue in the sorted lines returned by parseLyrics.
 * The manual offset adds to playback time: positive means earlier, negative later.
 * Returns -1 for plain text, invalid playback time or before the first cue.
 */
export function getActiveLyricIndex(lines: LyricLine[], playbackTime: number, offsetMs = 0): number {
  if (!Number.isFinite(playbackTime)) return -1;
  const time = playbackTime + (Number.isFinite(offsetMs) ? offsetMs : 0) / 1_000;
  let low = 0;
  let high = lines.length - 1;
  let active = -1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const cueTime = lines[middle].time;
    if (cueTime !== null && Number.isFinite(cueTime) && cueTime <= time) {
      active = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return active;
}
