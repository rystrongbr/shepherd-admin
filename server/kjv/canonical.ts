/**
 * Canonical KJV grounding for AI citations.
 * ─────────────────────────────────────────
 * After the model answers, every citation's `text` is replaced with the
 * verbatim text of the cited reference from the bundled King James corpus
 * (server/kjv/data/kjv.json — see server/kjv/PROVENANCE.md). Citations whose
 * reference can't be parsed or doesn't exist in the KJV are dropped.
 *
 * Gated by KJV_CANONICAL_TEXT=on (default OFF → zero behavior change).
 *
 * Logging: aggregate counters only. Never the question, answer, refs or text.
 */
import * as fs from "fs";
import * as path from "path";
import { bookSlug, parseRef, type ParsedRef } from "../ai-eval/kjvVerify";

// ─── Flag ─────────────────────────────────────────────────────────────

/** Read at call time so the flag can be flipped (and tests can toggle it). */
export function isCanonicalKjvEnabled(): boolean {
  const v = (process.env.KJV_CANONICAL_TEXT || "").trim().toLowerCase();
  return v === "on" || v === "true" || v === "1";
}

// ─── Corpus ───────────────────────────────────────────────────────────

export interface KjvCorpus {
  meta: { translation: string; verses: number; sha256?: string; sourceCommit?: string };
  books: Record<string, { name: string; chapters: string[][] }>;
}

let corpus: KjvCorpus | null = null;
let corpusLoadFailed = false;

/** Candidate locations: explicit override, the build copy in dist/, the repo copy. */
function corpusPaths(): string[] {
  const out: string[] = [];
  if (process.env.KJV_CORPUS_PATH) out.push(process.env.KJV_CORPUS_PATH);
  out.push(path.resolve(process.cwd(), "dist/kjv.json"));
  out.push(path.resolve(process.cwd(), "server/kjv/data/kjv.json"));
  return out;
}

/** Lazily loads the corpus once. Returns null (and logs once) if unavailable. */
export function loadCorpus(): KjvCorpus | null {
  if (corpus || corpusLoadFailed) return corpus;
  for (const p of corpusPaths()) {
    try {
      if (!fs.existsSync(p)) continue;
      const data = JSON.parse(fs.readFileSync(p, "utf8")) as KjvCorpus;
      if (!data?.books || Object.keys(data.books).length !== 66) continue;
      corpus = data;
      console.log(`[kjv] corpus loaded books=66 verses=${data.meta?.verses ?? "?"}`);
      return corpus;
    } catch {
      /* try next */
    }
  }
  corpusLoadFailed = true;
  console.error("[kjv] corpus NOT found; canonical KJV text disabled (citations pass through unchanged)");
  return null;
}

/** Test hook. */
export function setCorpusForTests(c: KjvCorpus | null) {
  corpus = c;
  corpusLoadFailed = false;
}

// ─── Reference resolution ─────────────────────────────────────────────

/** Common abbreviations / variants beyond what kjvVerify.bookSlug handles. */
const EXTRA_ALIASES: Record<string, string> = {
  gen: "genesis", ex: "exodus", exod: "exodus", lev: "leviticus", num: "numbers",
  deut: "deuteronomy", josh: "joshua", judg: "judges", ps: "psalms", psa: "psalms",
  prov: "proverbs", eccl: "ecclesiastes", eccles: "ecclesiastes", qoheleth: "ecclesiastes",
  song: "song-of-solomon", isa: "isaiah", jer: "jeremiah", lam: "lamentations",
  ezek: "ezekiel", dan: "daniel", hos: "hosea", mic: "micah", hab: "habakkuk",
  zeph: "zephaniah", hag: "haggai", zech: "zechariah", mal: "malachi",
  matt: "matthew", mt: "matthew", mk: "mark", lk: "luke", jn: "john",
  rom: "romans", gal: "galatians", eph: "ephesians", phil: "philippians",
  col: "colossians", heb: "hebrews", jas: "james", rev: "revelation",
  "1-cor": "1-corinthians", "2-cor": "2-corinthians", "1-thess": "1-thessalonians",
  "2-thess": "2-thessalonians", "1-tim": "1-timothy", "2-tim": "2-timothy",
  "1-pet": "1-peter", "2-pet": "2-peter", "1-sam": "1-samuel", "2-sam": "2-samuel",
  "1-kgs": "1-kings", "2-kgs": "2-kings", "1-chron": "1-chronicles", "2-chron": "2-chronicles",
  "song-of-songs": "song-of-solomon", "the-revelation": "revelation",
};

/** Whole-chapter citations longer than this are dropped rather than pasting a huge passage. */
export const MAX_VERSES_PER_CITATION = 40;

function resolveSlug(c: KjvCorpus, slug: string): string | null {
  if (c.books[slug]) return slug;
  const alt = EXTRA_ALIASES[slug] || EXTRA_ALIASES[bookSlug(slug.replace(/-/g, " "))];
  return alt && c.books[alt] ? alt : null;
}

/**
 * Canonical KJV text for a reference, verses joined with a single space,
 * or null if the reference can't be parsed or doesn't exist in the KJV.
 */
export function canonicalText(ref: string, c: KjvCorpus): string | null {
  // Tolerate a trailing translation tag like "John 3:16 (KJV)" or "John 3:16 KJV".
  const cleaned = (ref || "").replace(/\s*\(?\bKJV\b\)?\s*$/i, "").trim();
  const parsed: ParsedRef | null = parseRef(cleaned);
  if (!parsed) return null;
  const slug = resolveSlug(c, parsed.slug);
  if (!slug) return null;
  const book = c.books[slug];
  const parts: string[] = [];
  for (const r of parsed.ranges) {
    const verses = book.chapters[r.chapter - 1];
    if (!verses || !Number.isInteger(r.chapter) || r.chapter < 1) return null;
    const to = r.to ?? verses.length;
    if (r.from < 1 || r.from > to || to > verses.length) return null;
    for (let v = r.from; v <= to; v++) parts.push(verses[v - 1]);
  }
  if (!parts.length || parts.length > MAX_VERSES_PER_CITATION) return null;
  return parts.join(" ");
}

// ─── Grounding ────────────────────────────────────────────────────────

export interface GroundingCounts {
  /** Citations the model produced. */
  total: number;
  /** Model text already identical to the canonical text (whitespace-normalized). */
  exact: number;
  /** Model text differed and was replaced with canonical text. */
  replaced: number;
  /** Reference unparseable / not in the KJV → citation removed. */
  dropped: number;
}

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * Returns a new array of citations with canonical KJV text, plus counters.
 * Only `text` is rewritten; `ref` and every other field are preserved.
 */
export function groundCitations<T extends { ref: string; text: string }>(
  citations: T[],
  c: KjvCorpus,
): { citations: T[]; counts: GroundingCounts } {
  const counts: GroundingCounts = { total: citations.length, exact: 0, replaced: 0, dropped: 0 };
  const out: T[] = [];
  for (const cit of citations) {
    const canon = canonicalText(cit.ref, c);
    if (canon === null) {
      counts.dropped++;
      continue;
    }
    if (squash(cit.text || "") === canon) counts.exact++;
    else counts.replaced++;
    out.push({ ...cit, text: canon });
  }
  return { citations: out, counts };
}

/** Running process-wide totals (for ops visibility; no user content). */
export const kjvTotals: GroundingCounts & { responses: number; allDropped: number } = {
  responses: 0, total: 0, exact: 0, replaced: 0, dropped: 0, allDropped: 0,
};

export function logGrounding(tag: string, counts: GroundingCounts) {
  kjvTotals.responses++;
  kjvTotals.total += counts.total;
  kjvTotals.exact += counts.exact;
  kjvTotals.replaced += counts.replaced;
  kjvTotals.dropped += counts.dropped;
  if (counts.total > 0 && counts.dropped === counts.total) kjvTotals.allDropped++;
  console.log(
    `[kjv] ${tag} citations=${counts.total} exact=${counts.exact} replaced=${counts.replaced} dropped=${counts.dropped}`,
  );
}
