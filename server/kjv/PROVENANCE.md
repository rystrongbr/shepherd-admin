# KJV corpus provenance

`server/kjv/data/kjv.json` is the King James Version (public domain) used to
ground AI citations when `KJV_CANONICAL_TEXT=on` (see `docs/kjv-canonical-text.md`).

- Source: `github.com/rystrongbr/shepherd-mobile`, `src/data/bible/kjv/`
  (the same text the mobile app's Bible tab shows), commit
  `0b62dab8bd355c45b143dc359bd05cfac6ba68cc` (2026-11-18).
- Contents: 66 books, 1,189 chapters, 31,102 verses. No Apocrypha, no psalm
  superscriptions, no italics markup, no verse-paragraph marks.
- Shape: `{ meta, books: { [slug]: { name, chapters: string[][] } } }`;
  `chapters[c-1][v-1]` is the verse text exactly as in the mobile files.
- `meta.sha256` (of the `books` JSON): `bb6052019466663393b7134a562dc2e68dfce484ec7813d05dfa475ba100caf1`
- Regenerate: `npx tsx script/build-kjv-corpus.ts <shepherd-mobile>/src/data/bible/kjv <commit>`

## Known differences from the 1769 Oxford/Cambridge KJV

Compared verse by verse with eBible.org's `eng-kjv2006` (italics brackets and
¶ marks removed), 29,961 of 31,102 verses (96.3%) are identical. The rest:

- 709 punctuation/hyphenation only (e.g. "Bethel" for "Beth-el").
- 302 word-level, mostly spelling (Judaea/Judæa, Caesar/Cæsar, "any thing"/"anything",
  "first born"/"firstborn") and 129 missing psalm titles (merged into verse 1 in
  eBible). A handful look like true transcription errors (e.g. Joshua 4:5 "you"
  for "ye", Jeremiah 34:16 "he" for "ye", 2 Chronicles 33:19 "sins" for "sin").
- 130 capitalization, mostly "LORD" where the 1769 text has "Lord"
  (e.g. John 20:28 "My LORD and my God", Genesis 15:2 "LORD God" for "Lord GOD").

Fixing these should be done in shepherd-mobile first (so the Bible tab and the
answers stay word-for-word identical), then this file regenerated.
