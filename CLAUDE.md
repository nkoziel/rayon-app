# Rayon — notes for Claude Code

Standalone PWA: manga library, progress tracking, AniList cross-referenced recommendations.
No account, no server, everything local in the browser.

## Language policy

**All code, comments, documentation and commit messages are in English.**

**The UI ships in English by default, with French selectable** (decided 2026-08-23, so the
app is easy to share). The current code still has French strings hard-coded throughout
`index.html`; they are being migrated to a `t()` lookup — see the i18n phase in the vault
roadmap.

Consequences while that migration is in progress:
- New UI strings go through `t()` with an English default and a French entry. Never add a new
  hard-coded French string.
- French must stay a *complete* locale, not a partial fallback — the owner uses the app in
  French. A missing key falling back to English is a bug, not a graceful degradation.

## Layout — read this before editing anything

> **The root `index.html` is a BUILD ARTIFACT. Never edit it.**
> The next `npm run build` overwrites it and your change is gone without a trace.

| Path | What it is |
|---|---|
| `src/core/` | `dom`, `norm`, `store`, `state`, `i18n` — no UI, no app flow |
| `src/data/` | `anilist`, `mangadex`, `totals` — fetching and deriving |
| `src/import/` | `tachibk` (protobuf), `library` (import/merge/export/reset) |
| `src/ui/` | `library`, `sheet`, `tracker`, `discover`, `add`, `mihon`, `refresh` |
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

## Known traps

- `refreshTracker()` replaces `#trackwrap`'s `innerHTML` then calls `wireTracker()`, which does
  **not** rewire `removeBtn` (wired once in `openSheet`). Any button added to `trackerHTML()`
  must be wired in `wireTracker()`.
- AniList: 30 req/min. The current `sleep(700)` yields ~85 req/min → bursts of 429.
- `norm()` is called thousands of times per render — memoise it or move to the stable key.

## Data sources

| Source | Use | Constraint |
|---|---|---|
| AniList GraphQL | records, recommendations | 30 req/min, no key |
| MangaDex API | totals, volume split | CORS fine on `api.mangadex.org`; the image CDN is not |
| MangaBaka | cross-database ids, metadata, recommendations | base URL is `api.mangabaka.org` (**not** `.dev`, which is down); CC BY-NC-SA 4.0, attribution required, non-commercial |

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
- `README.md` — user documentation.
- Vault notes: `G:\Mon Drive\NKO\Projects\rayon-app\` (roadmap, MangaBaka API findings).
