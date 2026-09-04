# Rayon — notes for Claude Code

Standalone PWA: manga library, progress tracking, cross-referenced recommendations (MangaBaka first, AniList as fallback).
No account, no server, everything local in the browser.

## Language policy

**All code, comments, documentation and commit messages are in English.**

**The UI ships in English by default, with French selectable** (decided 2026-08-23, so the
app is easy to share). The migration to `t()` is **complete as of 2026-09-04**: no user-visible
string is hard-coded any more, in `src/index.html` or in any module.

- Every new UI string goes through `t()` with an English entry and a French one. Never add a
  hard-coded string of either language.
- French must stay a *complete* locale, not a partial fallback — the owner uses the app in
  French. A missing key falling back to English is a bug, not a graceful degradation, and
  `i18n.test.js` fails on one.
- Static markup is translated by `applyStatic()` through `data-i18n` / `data-i18n-attr`. A
  control whose label carries state (`#viewBtn`, `#unitBtn`) must NOT use `data-i18n` — it is set
  from JS at boot and on language change, or retranslating the shell silently resets the view.

## Layout — read this before editing anything

> **The root `index.html` is a BUILD ARTIFACT. Never edit it.**
> The next `npm run build` overwrites it and your change is gone without a trace.

| Path | What it is |
|---|---|
| `src/core/` | `dom`, `norm`, `store`, `state`, `i18n` — no UI, no app flow |
| `src/data/` | `anilist`, `mangadex`, `totals` — fetching and deriving |
| `src/import/` | `tachibk` (protobuf), `library` (import/merge/export/reset) |
| `src/ui/` | `library`, `sheet`, `tracker`, `discover`, `add`, `mihon`, `shopping`, `why`, `refresh` |
| `src/main.js` | wiring and boot only |
| `src/style.css`, `src/index.html` | CSS and the page shell |
| `index.html` (root) | generated single file, committed, served by Pages |
| `sw.js`, `manifest.webmanifest`, `icons/` | PWA files, outside the bundle, edited directly |

```
npm run build      # src/ -> dist/index.html -> copied to the repo root
npm run verify     # zero-dependency checks, see below
npm run dev        # Vite dev server on src/
node tools/check-refs.js   # free variables + import cycles
```

**The dependency graph is acyclic and must stay that way**: `main → ui → data → core`.
When a UI module needs to tell the app "the library changed, redraw", call `libraryChanged()`
from `ui/refresh.js` — do **not** import whatever owns rendering. `check-refs.js` fails on a
cycle, because ES modules tolerate them for hoisted functions and then throw on a `const` in
its temporal dead zone, on whichever path happens to run first.

The root file is committed on purpose: GitHub Pages serves the repo root, and cloning the repo
and double-clicking `index.html` has to keep working with no build step. **Rebuild and commit
the root file in the same commit as the `src/` change** — otherwise the deployed app silently
lags behind the source. `npm run verify` fails if it detects that.

`src/main.js` is still one ~1,470-line module; splitting it into `src/core`, `src/data`,
`src/ui`… is the remaining part of phase 4. It runs as an ES module, so top-level declarations
are **not** global — `window.__rayon` exposes them deliberately for console debugging, which
is how every behavioural check on this app has been done.

## Invariants — do not violate

1. **An entry's key is `al` (AniList id) otherwise `id` (uid). NEVER the title.**
   The original code indexed by `norm(title)`, which was blocking bug §1.1: `norm()` stripped
   every non-ASCII character, so all Japanese/Korean/Chinese titles produced `""` and
   overwrote each other. The unicode part is fixed; the stable key is still pending.
   `norm()` must only ever serve fuzzy matching and import merging, never cache indexing.

2. **`norm()` must keep `.normalize("NFC")` before filtering.**
   NFD decomposes `ピ` into `ヒ` + handakuten (U+309A), which is a mark and not a letter, so
   `[^\p{L}\p{N}]` strips it: `ワンピース` → `ワンヒース`, and `パパ` collides with `ハハ`.

3. **`localStorage` holds only the library and small preferences.**
   Every large, regenerable cache belongs in the IndexedDB `cache` store via `kvGet`/`kvSet`.
   `store.set()` returns `false` when the quota is full and now warns — do not add a caller
   that ignores it again (§1.2).

4. **Bump `VERSION` in `sw.js` on every release**, otherwise no installed user ever receives
   the update (§1.3). Documents are served network-first.

5. **Rayon does not read anything. Mihon is the reader.**
   The embedded reader was removed on 2026-08-23 — no CBZ decoding, no offline chapter
   storage, no folder scanning. A series sheet hands the title to Mihon through an Android
   intent (`eu.kanade.tachiyomi.SEARCH`). Do not reintroduce in-app reading.

6. **No aggregator scraping.** Legitimate sources (official MangaDex, the user's own files,
   licensed publishers) are fine; a Mihon-style extension engine pointed at pirate
   aggregators is not.

7. **Do not break opening the file directly.** `index.html` must stay usable without a server.
   If a build is introduced, it must emit a single file (`vite-plugin-singlefile`).

8. **Never compare against display text.** Every value the code branches on is an internal
   token, and the label is looked up only when it is rendered. This was violated three times and
   each one was a bug the tests could not see:
   - `progressOf().unit` returned `"tomes"`, and callers tested `p.unit === "tomes"` — a
     comparison against the interface language, which stopped matching in English.
   - `META.statut` held `"Terminé"` from AniList, `"releasing"` from MangaBaka and a third
     spelling from Mihon backups, while `totals()` tested for `"Terminé"`.
   - "Show all" set `state.source = "Toutes"`, which matches no source, so clearing the filters
     emptied the library instead of showing it.

   Tokens now: `"vol"`/`"ch"` for units, MangaBaka's status vocabulary for `statut` (mapped at
   the edge in `anilist.js` and `tachibk.js`), `"all"` for every filter axis, `"manual"` for the
   hand-added source. Labels come from `unitLabel()`, `unitShort()`, `statusLabel()`,
   `sourceLabel()`, `srcLabel()`, `srcNote()`. Records cached before a token existed still hold
   the old French string, so each mapper passes an unknown value through unchanged — do not
   "clean up" those legacy branches without a migration.

## Known traps

- `refreshTracker()` replaces `#trackwrap`'s `innerHTML` then calls `wireTracker()`, which does
  **not** rewire `removeBtn` (wired once in `openSheet`). Any button added to `trackerHTML()`
  must be wired in `wireTracker()`.
- AniList: 30 req/min. The current `sleep(700)` yields ~85 req/min → bursts of 429.
- `norm()` is called thousands of times per render — memoise it or move to the stable key.

## Recommendations

Both surfaces — the detail sheet and the Discover tab — go through `data/recos.js` `recosFor()`.
Discover used to call AniList's `loadRecos` directly, which meant two paths and two different
answers to the same question; it now shares one.

`ui/why.js` renders the evidence as badges and is imported by both. It lives in its own module
rather than in `sheet.js` so Discover can use it without closing an import cycle.

Two shapes flow through it. MangaBaka items carry `why` (`sharedUsers`, `tags`, `tagsTotal`,
`sameAuthor`, `score`); AniList items carry only `votes`. `strengthOf()` reduces either to one
comparable number so ranking does not care which source answered.

Gotchas worth keeping:
- MangaBaka ids are on `.mb`; `.id` (AniList) is often `null`. Key on `mb ?? id`, never `id`.
- `DISMISSED` holds **strings**. It used to hold AniList numbers, and a mixed Set answers
  `has("123")` false for a stored `123`, which silently un-dismisses everything.
- `shared_tags_total` is a real count in the dozens; the returned `shared_tags` list is
  truncated. Show the count, put the sampled names in the tooltip.
- Badge colours were measured, not picked: `--press` (4.01:1) and `--vermilion` (3.75:1) both
  fail WCAG AA on `--paper` at 9px, so the badges use darker shades of their own.

## Importing a Mihon backup

A `.tachibk` is a record of the **app**, not of the library. It keeps every series ever opened,
including ones removed from favourites, and **one row per source** — migrate a series between
Asura Scans and Mangakakalot and it appears twice.

`consolidateMihon()` in `import/tachibk.js` fixes both, and its rules came from measuring a real
232-entry backup rather than from the schema:

| | |
|---|---|
| favourite flag | protobuf field **100**. kotlinx omits the `= true` default, so **absent = favourite**, `0` = un-favourited. 118 absent, 114 zero. |
| duplicates | every one of the 43 duplicated titles had exactly **one** favourite copy, so honouring the flag removes them all — no dedup heuristic has to guess a winner |
| progress | the favourite copy can hold **less** than the copy it replaced (Berserk: favourite 0 read, abandoned copy 393). Fold, never drop: progress takes the highest value in the group |

Result on that backup: 232 rows → 118 series, 43 duplicate titles → 0, Berserk keeps its 393.
Chapters read drops 32,308 → 13,586, because the old number counted the same chapters once per
source. The import toast reports how many rows were left out.

Two guards worth keeping: two favourites under one title are left alone (deliberately separate
series), and two different AniList ids sharing a title are never folded — same rule as
`mergeLibraries`.

## Data sources

| Source | Use | Constraint |
|---|---|---|
| AniList GraphQL | records, recommendations (fallback only) | 30 req/min, no key; returned 403 for a stretch of this project, answering again as of 2026-08-23 — which is why nothing depends on it alone |
| MangaDex API | totals, volume split | CORS fine on `api.mangadex.org`; the image CDN is not |
| MangaBaka | cross-database ids, metadata, recommendations (**preferred**) | base URL is `api.mangabaka.org` (**not** `.dev`, which is down); CC BY-NC-SA 4.0, attribution required, non-commercial |

## Verifying a change

```
npm run verify      # all three of the below
npm test            # Vitest — behaviour
npm run structure   # free variables + import cycles
node tools/verify.js   # module syntax + the published bundle
```

**`npm test`** — 55 tests over `norm` (§1.1, including the `パパ`/`ハハ` collision the NFC step
prevents), the totals provenance cascade, the merge rules (§1.5, "progress never moves
backwards"), and i18n completeness. Add a case whenever you fix a logic bug; that is how these
stopped being able to regress silently.

**`npm run structure`** — Rollup resolves imports but says nothing about a name that used to be
a global and is now neither declared nor imported: it bundles fine and throws at runtime. Also
fails on import cycles.

**`node tools/verify.js`** — the part Vitest cannot see: every module parses, and the published
root `index.html` is still one self-contained file that has not fallen behind `src/`.

Anything involving real storage, the network, or the service worker still needs a browser.

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
- `README.md` — the pitch and the getting-started path, with screenshots in `docs/screenshots/`.
  Keep it about what the app is worth; reference material belongs in `docs/`.
- `docs/TOTALS.md` — the totals cascade source by source, the two tracking axes, storage split.
- `docs/ANDROID.md` — installing, APK packaging, Digital Asset Links, the Mihon intent.
- Vault notes: `G:\Mon Drive\NKO\Projects\rayon-app\` (roadmap, MangaBaka API findings).

**Screenshots** are captured from a seeded library at a ~1200 px viewport and cropped to
1400 px wide. Photographic ones (grid, Discover, Shopping) are JPEG; text-heavy panels (sheet,
volume grid) are PNG — each is whichever encoding came out smaller.
