# Rayon — notes for Claude Code

Standalone PWA: manga library, progress tracking, AniList cross-referenced recommendations.
No account, no server, everything local in the browser.

## Language policy

**All code, comments, documentation and commit messages are in English.**
The **user-facing UI strings stay French** — the app is a French-language product.
Do not translate UI copy without being asked.

## State of the code

`index.html` is a **single ~1,970-line file** (HTML + CSS + inline JS). The module split is
planned (see `REVIEW.md` §8 phase 1) but **not done yet**. Until it is: edit with targeted
`Edit` calls, never rewrite the whole file.

## Invariants — do not violate

1. **An entry's key is `al` (AniList id) otherwise `id` (uid). NEVER the title.**
   The original code indexed by `norm(title)`, which was blocking bug §1.1: `norm()` stripped
   every non-ASCII character, so all Japanese/Korean/Chinese titles produced `""` and
   overwrote each other. The unicode part is fixed; the stable key is still pending.
   `norm()` must only ever serve fuzzy matching (Mihon folder), never cache indexing.

2. **`norm()` must keep `.normalize("NFC")` before filtering.**
   NFD decomposes `ピ` into `ヒ` + handakuten (U+309A), which is a mark and not a letter, so
   `[^\p{L}\p{N}]` strips it: `ワンピース` → `ワンヒース`, and `パパ` collides with `ハハ`.

3. **`store.set()` returns `false` when the quota is full — that value must be read.**
   Today it is ignored everywhere, so the library silently stops saving past ~5 MB (§1.2).

4. **Bump `VERSION` in `sw.js` on every release**, otherwise no installed user ever receives
   the update (§1.3). Documents are served network-first.

5. **No aggregator scraping.** Legitimate sources (official MangaDex, the user's own files,
   licensed publishers) are fine; a Mihon-style extension engine pointed at pirate
   aggregators is not.

6. **Do not break opening the file directly.** `index.html` must stay usable without a server.
   If a build is introduced, it must emit a single file (`vite-plugin-singlefile`).

## Known traps

- `refreshTracker()` replaces `#trackwrap`'s `innerHTML` then calls `wireTracker()`, which does
  **not** rewire `removeBtn` (wired once in `openSheet`). Any button added to `trackerHTML()`
  must be wired in `wireTracker()`.
- `chapNumOf()` falls back to "first number in the filename": `[2024] Vol.3 - 12.cbz` returns
  `2024`, and `finish()` writes it into progress (§1.6).
- AniList: 30 req/min. The current `sleep(700)` yields ~85 req/min → bursts of 429.
- `norm()` is called thousands of times per render — memoise it or move to the stable key.

## Data sources

| Source | Use | Constraint |
|---|---|---|
| AniList GraphQL | records, recommendations | 30 req/min, no key |
| MangaDex API | totals, volume split | CORS fine on `api.mangadex.org`; the image CDN is not |
| MangaBaka | cross-database ids, metadata, recommendations | base URL is `api.mangabaka.org` (**not** `.dev`, which is down); CC BY-NC-SA 4.0, attribution required, non-commercial |

## Environment

- **Verify Node/npm before assuming a build step** — they were absent on this machine as of
  2026-08-23 and were installed specifically for the APK work.
- `git` 2.55 and `gh` 2.98 present; `gh` authenticated as `nkoziel`.
- Repo lives at `C:\dev\rayon-app`. It was moved **out of Google Drive** — Drive rewrites
  `.git/objects` mid-operation and corrupts repos.
- Commit identity is the GitHub `noreply` address on purpose: the repo is public.

## Reference documents

- `REVIEW.md` — full technical review, numbered findings (§1.1 to §6). Those numbers are
  authoritative in commits and discussion.
- `README.md` — user documentation.
- Vault notes: `G:\Mon Drive\NKO\Projects\rayon-app\` (roadmap, MangaBaka API findings).
