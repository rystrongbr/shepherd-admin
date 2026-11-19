// Regenerates server/kjv/data/kjv.json from the shepherd-mobile bundled KJV
// (src/data/bible/kjv/<book-slug>/<chapter>.json + index.json).
//
//   npx tsx script/build-kjv-corpus.ts <path-to-shepherd-mobile>/src/data/bible/kjv <mobile-commit-sha>
//
// Output shape: { meta, books: { [slug]: { name, chapters: string[][] } } }
// where chapters[c-1][v-1] is the verbatim corpus text of chapter c, verse v.
import * as fs from "fs";
import * as path from "path";
import { createHash } from "crypto";

const [srcDir, commit = "unknown"] = process.argv.slice(2);
if (!srcDir) {
  console.error("usage: tsx script/build-kjv-corpus.ts <kjvDir> [commit]");
  process.exit(1);
}
const index = JSON.parse(fs.readFileSync(path.join(srcDir, "index.json"), "utf8")) as {
  books: Array<{ name: string; slug: string; chapterCount: number; verseCounts: number[] }>;
};
const books: Record<string, { name: string; chapters: string[][] }> = {};
let verses = 0;
for (const b of index.books) {
  const chapters: string[][] = [];
  for (let c = 1; c <= b.chapterCount; c++) {
    const data = JSON.parse(fs.readFileSync(path.join(srcDir, b.slug, `${c}.json`), "utf8")) as {
      verses: Array<{ n: number; t: string }>;
    };
    data.verses.forEach((v, i) => {
      if (v.n !== i + 1) throw new Error(`${b.slug} ${c}: verse numbering gap at ${v.n}`);
    });
    if (data.verses.length !== b.verseCounts[c - 1]) throw new Error(`${b.slug} ${c}: verse count mismatch`);
    chapters.push(data.verses.map((v) => v.t));
    verses += data.verses.length;
  }
  books[b.slug] = { name: b.name, chapters };
}
const body = JSON.stringify(books);
const out = {
  meta: {
    translation: "KJV",
    translationName: "King James Version",
    license: "Public Domain",
    source: "github.com/rystrongbr/shepherd-mobile src/data/bible/kjv",
    sourceCommit: commit,
    books: index.books.length,
    verses,
    sha256: createHash("sha256").update(body).digest("hex"),
  },
  books,
};
const dest = path.join(process.cwd(), "server/kjv/data/kjv.json");
fs.writeFileSync(dest, JSON.stringify(out));
console.log(`wrote ${dest}: ${index.books.length} books, ${verses} verses`);
