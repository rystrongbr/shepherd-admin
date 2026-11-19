# Canonical KJV text in AI answers

Flag: `KJV_CANONICAL_TEXT` (Railway env var). Default **off**.

| Value | Behavior |
|---|---|
| unset / `off` | Unchanged: citation text is whatever the model wrote. |
| `on` (`true`, `1`) | After the model answers and the answer passes validation, each citation's `text` is replaced with the verbatim text of its `ref` from `server/kjv/data/kjv.json`. Citations whose reference can't be parsed or doesn't exist in the KJV are removed. |

Applies to `/api/ai/ask` and `/api/ai/passage` (and their `/api/v1/...` aliases used by
mobile), plus the legacy `/api/ai/scripture` and `/api/ai/deeper` fallback. Crisis
interception runs before any of this and is untouched.

Details (flag on):

- Response shape never changes. Only `citations[].text` is rewritten (and invalid citations removed). `ref`, `relevance`, `answer`, `followUps` are untouched.
- References: single verses, ranges (`4:6-7`, en/em dashes), lists (`5:3-5, 7`), cross-chapter (`3:36-4:2`), whole chapters (`Psalm 23`, max 40 verses), book variants (`Psalm`/`Psalms`, `1 Cor`, `First Corinthians`, `Song of Songs`, trailing `(KJV)`).
- If every citation is removed, the answer is treated as invalid and the existing single retry runs. If the retry also has no real KJV reference, the request fails exactly as an invalid answer does today (500, which the web app already falls back from).
- Legacy single-verse path: verse text replaced; an unknown reference fails the request like today's "incomplete response".
- If the corpus file can't be found, the server logs `[kjv] corpus NOT found` once and passes answers through unchanged (fail-open to today's behavior).
- Logs: `[kjv] ai-v2 attempt=N citations=N exact=N replaced=N dropped=N`. Counts only, never questions, references or text. At boot: `KJV canonical text: on|off`.

## Enable

Railway → shepherd-admin service → Variables → `KJV_CANONICAL_TEXT=on` → redeploy (Railway restarts on variable change). Confirm the boot log shows `[kjv] corpus loaded books=66 verses=31102` and `KJV canonical text: on`.

## Roll back

Set `KJV_CANONICAL_TEXT=off` (or delete it). No code revert needed.

## Measuring

`script/ai-eval.ts` forces the flag off and reports "Exact KJV wording", the share of model citations that already match the corpus character for character (that is, what the flag leaves unchanged).
