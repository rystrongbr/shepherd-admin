# KJV corpus provenance

`server/kjv/data/kjv.json` is the King James Version (public domain) used to
ground AI citations when `KJV_CANONICAL_TEXT=on` (see `docs/kjv-canonical-text.md`).

- Source: `github.com/rystrongbr/shepherd-mobile`, `src/data/bible/kjv/`
  (the same text the mobile app's Bible tab shows) at commit
  `ddc151f291f18157d60697954b62c3dc1405b498`, branch `fix/kjv-text-corrections`
  ([shepherd-mobile#44](https://github.com/rystrongbr/shepherd-mobile/pull/44)): the
  `0b62dab` data plus 132 verse corrections (LORD/Lord, Lord GOD, typos, one missing word).
  Once #44 merges, regenerate from `main` to record the merge commit.
- Contents: 66 books, 1,189 chapters, 31,102 verses. No Apocrypha, no psalm
  superscriptions, no italics markup, no verse-paragraph marks.
- Shape: `{ meta, books: { [slug]: { name, chapters: string[][] } } }`;
  `chapters[c-1][v-1]` is the verse text exactly as in the mobile files.
- `meta.sha256` (of the `books` JSON): `34f48b6fc7b2a7a06851a059c50a0564257e9a1cb2a564efb3be67336a0b36f7`
- Regenerate: `npx tsx script/build-kjv-corpus.ts <shepherd-mobile>/src/data/bible/kjv <commit>`

## Known differences from the 1769 KJV

Compared verse by verse with eBible.org's `eng-kjv2006` (italics brackets and ¶ removed;
wording cross-checked against CrossWire's KJV), 30,080 of 31,102 verses (96.7%) are
identical. The remaining differences are intentional edition/spelling variants, left alone:

- 711 punctuation/hyphenation (e.g. "Bethel" for "Beth-el").
- Spelling, ligature and compounding variants (Judaea/Judæa, cloak/cloke, "any thing"/"anything").
- 116 psalm superscriptions not included (merged into verse 1 in the 1769 printing).
- 22 capitalization-style variants ("son of David", chapter-opening caps like "A GOOD name").
- About 30 proper-name spellings to review later (e.g. Adonizedec/Adonizedek).

The full list of the 132 fixed verses is in shepherd-mobile#44.
