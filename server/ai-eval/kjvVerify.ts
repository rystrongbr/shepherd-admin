// Verifies a model citation ({ ref, text }) against a local KJV corpus in the
// mobile app's format: <kjvDir>/<book-slug>/<chapter>.json =
// { book, chapter, verses: [{ n, t }] }. Used only by script/ai-eval.ts.
import * as fs from "fs";
import * as path from "path";

export type KjvStatus = "verified" | "close" | "text_mismatch" | "invalid_ref" | "unparsed";

export interface KjvResult {
  status: KjvStatus;
  similarity?: number;
  detail?: string;
}

const ALIASES: Record<string, string> = {
  psalm: "psalms",
  "song of songs": "song-of-solomon",
  canticles: "song-of-solomon",
  revelations: "revelation",
  "revelation of john": "revelation",
};

export function bookSlug(book: string): string {
  const b = book.toLowerCase().replace(/\./g, "").replace(/\s+/g, " ").trim()
    .replace(/^first /, "1 ").replace(/^second /, "2 ").replace(/^third /, "3 ")
    .replace(/^i /, "1 ").replace(/^ii /, "2 ").replace(/^iii /, "3 ");
  return (ALIASES[b] || b).replace(/ /g, "-");
}

export interface ParsedRef {
  slug: string;
  ranges: Array<{ chapter: number; from: number; to: number | null }>; // to=null → end of chapter
}

/** Handles "John 3:16", "Philippians 4:6-7", "Romans 8:38-39", "Matthew 5:3-5, 7", "John 3:16-4:2", "Psalm 23". */
export function parseRef(ref: string): ParsedRef | null {
  const m = ref.trim().match(/^((?:[1-3]\s+)?[A-Za-z][A-Za-z .]*?)\s+(\d+)(?::(.+))?$/);
  if (!m) return null;
  const slug = bookSlug(m[1]);
  const chapter = Number(m[2]);
  if (!m[3]) return { slug, ranges: [{ chapter, from: 1, to: null }] };
  const ranges: ParsedRef["ranges"] = [];
  let current = chapter;
  for (const partRaw of m[3].split(/[,;]/)) {
    const part = partRaw.trim().replace(/[–—]/g, "-");
    if (!part) continue;
    let mm = part.match(/^(\d+)-(\d+):(\d+)$/); // 16-4:2 (cross-chapter)
    if (mm) {
      ranges.push({ chapter: current, from: Number(mm[1]), to: null });
      current = Number(mm[2]);
      ranges.push({ chapter: current, from: 1, to: Number(mm[3]) });
      continue;
    }
    mm = part.match(/^(\d+):(\d+)(?:-(\d+))?$/); // "5:3-5" after a semicolon
    if (mm) {
      current = Number(mm[1]);
      ranges.push({ chapter: current, from: Number(mm[2]), to: Number(mm[3] || mm[2]) });
      continue;
    }
    mm = part.match(/^(\d+)(?:-(\d+))?[a-c]?$/);
    if (!mm) return null;
    ranges.push({ chapter: current, from: Number(mm[1]), to: Number(mm[2] || mm[1]) });
  }
  return ranges.length ? { slug, ranges } : null;
}

export function normalize(text: string): string {
  return text.toLowerCase()
    .replace(/[\u2018\u2019]/g, "'").replace(/[^a-z0-9' ]+/g, " ")
    .replace(/\s+/g, " ").trim();
}

/** Word-level similarity: 2*LCS / (len(a)+len(b)). 1 = identical. */
export function similarity(a: string, b: string): number {
  const x = normalize(a).split(" ").filter(Boolean);
  const y = normalize(b).split(" ").filter(Boolean);
  if (!x.length || !y.length) return 0;
  let prev = new Array(y.length + 1).fill(0);
  for (let i = 1; i <= x.length; i++) {
    const cur = new Array(y.length + 1).fill(0);
    for (let j = 1; j <= y.length; j++) {
      cur[j] = x[i - 1] === y[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    }
    prev = cur;
  }
  return (2 * prev[y.length]) / (x.length + y.length);
}

export function loadPassage(kjvDir: string, parsed: ParsedRef): string | { error: string } {
  const parts: string[] = [];
  for (const r of parsed.ranges) {
    const file = path.join(kjvDir, parsed.slug, `${r.chapter}.json`);
    if (!fs.existsSync(file)) return { error: `no such book/chapter: ${parsed.slug} ${r.chapter}` };
    const data = JSON.parse(fs.readFileSync(file, "utf8")) as { verses: Array<{ n: number; t: string }> };
    const last = data.verses.length ? data.verses[data.verses.length - 1].n : 0;
    const to = r.to ?? last;
    if (r.from < 1 || to > last || r.from > to) return { error: `verse out of range: ${parsed.slug} ${r.chapter}:${r.from}-${to} (chapter has ${last})` };
    for (const v of data.verses) if (v.n >= r.from && v.n <= to) parts.push(v.t);
  }
  return parts.join(" ");
}

export function verifyCitation(kjvDir: string, ref: string, text: string): KjvResult {
  const parsed = parseRef(ref);
  if (!parsed) return { status: "unparsed", detail: `could not parse "${ref}"` };
  const passage = loadPassage(kjvDir, parsed);
  if (typeof passage !== "string") return { status: "invalid_ref", detail: passage.error };
  const sim = similarity(text, passage);
  // Models sometimes quote only part of a cited range; accept a strong
  // partial match if the quoted words appear in order in the passage.
  const contained = normalize(passage).includes(normalize(text));
  const status: KjvStatus = sim >= 0.9 || (contained && normalize(text).length > 20) ? "verified" : sim >= 0.7 ? "close" : "text_mismatch";
  return { status, similarity: Math.round(sim * 100) / 100 };
}
