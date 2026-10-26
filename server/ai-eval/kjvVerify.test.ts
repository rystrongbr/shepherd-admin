import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { parseRef, bookSlug, verifyCitation } from "./kjvVerify.ts";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kjv-"));
fs.mkdirSync(path.join(dir, "john"));
fs.writeFileSync(path.join(dir, "john", "3.json"), JSON.stringify({ book: "john", chapter: 3, verses: [
  { n: 16, t: "For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life." },
  { n: 17, t: "For God sent not his Son into the world to condemn the world; but that the world through him might be saved." },
] }));
fs.mkdirSync(path.join(dir, "psalms"));
fs.writeFileSync(path.join(dir, "psalms", "23.json"), JSON.stringify({ book: "psalms", chapter: 23, verses: [{ n: 1, t: "The LORD is my shepherd; I shall not want." }] }));

test("book slugs", () => {
  assert.equal(bookSlug("1 John"), "1-john");
  assert.equal(bookSlug("Psalm"), "psalms");
  assert.equal(bookSlug("Song of Solomon"), "song-of-solomon");
  assert.equal(bookSlug("II Corinthians"), "2-corinthians");
});

test("parse refs", () => {
  assert.deepEqual(parseRef("John 3:16-17"), { slug: "john", ranges: [{ chapter: 3, from: 16, to: 17 }] });
  assert.deepEqual(parseRef("1 John 4:18"), { slug: "1-john", ranges: [{ chapter: 4, from: 18, to: 18 }] });
  assert.deepEqual(parseRef("Matthew 5:3-5, 7")?.ranges, [{ chapter: 5, from: 3, to: 5 }, { chapter: 5, from: 7, to: 7 }]);
  assert.equal(parseRef("not a ref"), null);
});

test("verified, close, mismatch, invalid", () => {
  assert.equal(verifyCitation(dir, "John 3:16", "For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.").status, "verified");
  assert.equal(verifyCitation(dir, "Psalm 23:1", "The LORD is my shepherd; I shall not want.").status, "verified");
  assert.equal(verifyCitation(dir, "John 3:16-17", "For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.").status, "verified");
  assert.equal(verifyCitation(dir, "John 3:16", "God loves everyone so much that He sent Jesus to save us.").status, "text_mismatch");
  assert.equal(verifyCitation(dir, "John 3:99", "x").status, "invalid_ref");
  assert.equal(verifyCitation(dir, "Hezekiah 1:1", "x").status, "invalid_ref");
});
