# Rayon — technical review

Review of 23 August 2026, of the state delivered by the Claude Android app.
Scope: `index.html` (1,967 lines), `sw.js`, `manifest.webmanifest`, `README.md`.

> **Status note (2026-08-23).** This document is the original review, kept as the reference
> for issue numbering. Items already fixed are marked ✅ inline. Execution order lives in the
> vault roadmap, not here.

---

## Verdict in three lines

The product is good and the app **works**: protobuf decoding of `.tachibk` with no dependency,
a CBZ reader written by hand on `DecompressionStream`, the provenance cascade for totals —
this is serious work, not a demo. What is missing is everything that makes a project
**durable**: no version control, no tests, no modules, and a handful of bugs that quietly
bite user data.

The three things to fix before any new feature:
**(1)** non-Latin titles break indexing, **(2)** `localStorage` will silently fill up,
**(3)** the service worker will never deliver an update.

---

## 1. Blocking bugs

### 1.1 All Japanese / Korean / Chinese titles overwrite each other ✅ *partially fixed*

`index.html:304`

```js
const norm = s => (s||"").toLowerCase().normalize("NFD")
  .replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]/g,"");
```

`[^a-z0-9]` strips everything that is not ASCII. Verified:

| Title | `norm()` |
|---|---|
| `進撃の巨人` | `""` |
| `나 혼자만 레벨업` | `""` |
| `ワンピース` | `""` |
| `One Piece` | `"onepiece"` |

And `norm(title)` is **the primary key of the whole application**: `META`, `MDCACHE`,
`OWNED`, `reco:v3:…`, `pickedFor`, `folderChaptersFor`, and `addFromMedia` deduplication.

Concrete consequences for a Mihon library holding original-language titles:

- all those series share **one single** AniList record (`META[""]`);
- `OWNED` contains `""`, so `isOwned()` returns true for any recommendation whose title is
  non-Latin → the Discover tab hides them all;
- `addFromMedia` answers "Already in your list" and refuses to add;
- the `reco:v3:` recommendation cache is shared between all of them.

**Fix**: stop indexing by title. Every entry already has an `id` (uid) and often an `al`
(AniList id). Key = `al` if present, otherwise `id`. And for fuzzy matching (Mihon folder),
a `norm()` that preserves unicode: `.replace(/[^\p{L}\p{N}]/gu,"")`.

> ✅ **Done 2026-08-23** — the unicode-preserving `norm()` shipped, which removes the
> catastrophic collision (12 sample titles: 4 distinct keys / 4 empty → 12 distinct / 0 empty).
> A `.normalize("NFC")` step proved necessary: NFD decomposes `ピ` into `ヒ` + handakuten
> (U+309A), a *mark* rather than a letter, so the filter stripped it — `ワンピース` became
> `ワンヒース` and `パパ` collided with `ハハ`.
> **Still open**: the stable `al`/`id` key. Now a quality issue (duplicate fetches across
> title variants, orphaned cache after a rename) rather than a data-destroying one.

### 1.2 `localStorage` silently fills up and the library stops being saved

`index.html:312`

```js
set(k,v){ try{ localStorage.setItem(k,JSON.stringify(v)); return true; }catch(e){ return false; } },
```

The `return false` is **read nowhere**. `saveLib()`, `saveMeta()`, `store.set("md:v1", …)` and
`store.set(key, payload)` all ignore the return value.

Real volumes (the README claimed "300 KB for 200 series", which is a large underestimate):

| Key | Content | ~200 series | ~800 series (typical Mihon) |
|---|---|---|---|
| `lib:v1` | entries | 120 KB | 480 KB |
| `meta:v2` | records + 900-char `desc` | 240 KB | 960 KB |
| `reco:v3:*` | 12 recos × ~600 B **per series** | 1.4 MB | 5.8 MB |
| `md:v1` | volume split | 60 KB | 240 KB |

The `localStorage` quota is ~5 MB per origin. A normal Mihon library exceeds it **on the first
run through Discover**. From then on, every chapter increment, every add, every removal is lost
on reload, without a single message.

**Fix**: migrate `META`, `MDCACHE` and the `reco:` caches to IndexedDB (the `rayon-reader`
database already exists, it only needs a `cache` object store). Keep `localStorage` for
preferences only (`unit`, `panel`, `seeds`). And surface the failure:
`if (!store.set(...)) toast("Storage full — export your library")`.

### 1.3 The service worker will never deliver an update ✅ *fixed*

`sw.js:2` — `const CACHE = "rayon-v1"`, never bumped, and `index.html` served
**cache-first**. The SW only reinstalls when the bytes of `sw.js` change; since only
`index.html` is edited, the browser keeps serving the version installed on day one,
indefinitely. A user who installed the app will never see your fixes.

Side effect: the TWA produced by PWABuilder inherits the same trap, while the README promised
"any update to the site is reflected without reinstalling".

**Fix**: `index.html` *network-first* (with cache fallback), immutable assets cache-first, and
a version number injected at build time. Plus `updatefound` → "New version — reload" toast.

> ✅ **Done 2026-08-23** — explicit `VERSION`, network-first documents, separate non-purged
> runtime cache for fonts and covers, `updateViaCache: "none"`, update toast. Fixed *before*
> the app was shared publicly, since it would otherwise have been unrecoverable for every
> early installer.

### 1.4 "Remove" stops working as soon as you touch the counter

`index.html:1488` declares `<button id="removeBtn">` **inside** `trackerHTML()`.
`openSheet` (`index.html:1598`) attaches its handler **after** `wireTracker(d)`.

But `refreshTracker()` (`index.html:1493`) does:

```js
$("trackwrap").innerHTML = trackerHTML(d);   // the button is recreated
wireTracker(d);                              // …and wireTracker never wires removeBtn
```

Reproduction: open a sheet → click `+` → click **Remove** → nothing.
The button is dead until the sheet is reopened.

**Fix**: wire `removeBtn` in `wireTracker`, or move it out of `trackerHTML` (it has no business
in a progress-tracking block — it is a destructive action and deserves its own place).

### 1.5 Import overwrites the library with no confirmation

`index.html:647` — `LIB = { label, entries };` then `saveLib()`.

A drag-and-drop onto the window triggers `importFile` directly (`index.html:1926`).
A `.json` dropped by mistake instantly replaces the library, its progress, manually entered
totals, and per-series units. No `confirm`, no undo, and `store.del("discover:v1")` on the way.

**Fix**: `confirm()` showing the before/after counts, and offer **merge** rather than replace
(match on `al`, keep `max(r)` from each side). That is also what makes swapping lists between
friends genuinely usable — today, receiving a friend's list destroys your own.

### 1.6 A number in a filename can push progress to 2024

`index.html:1221`

```js
const chapNumOf = name => {
  const m = String(name).match(/(?:ch(?:ap(?:ter|itre)?)?[\s._-]*)(\d+(?:\.\d+)?)/i)
         || String(name).match(/(\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : null;
};
```

The fallback takes **the first number in the name**. Verified:

| Filename | `chapNumOf` |
|---|---|
| `Chapter 145.cbz` | 145 ✓ |
| `one-piece-1102.cbz` | 1102 ✓ |
| `Solo Leveling 179 (2021).cbz` | 179 ✓ |
| `[2024] Vol.3 - 12.cbz` | **2024** ✗ |
| `Asura Scans 2024 - 05.cbz` | **2024** ✗ |
| `Volume 05.cbz` | **5** (that is a volume, not a chapter) ✗ |

And `finish()` (`index.html:1386`) applies `if (n && n > entry.r) entry.r = n;`
→ marking a chapter read can write **2024 chapters read** into the library, irreversibly.

**Fix**: cap it (`n <= (totals(d).ch || n)`), ignore 4-digit numbers that look like years,
exclude `vol`/`volume` patterns, and ask for confirmation beyond a +5 jump.

---

## 2. Serious bugs

### 2.1 The reader rewrites the whole chapter to the database on every page turn

`index.html:1379` — inside `go()`: `putChapter(chapter)`.

`chapter.pages` is an array of `Blob`. A 40-page chapter is 15–40 MB. On every tap on the
left/right zone, the app performs a *structured clone* and an IndexedDB write of the whole
thing. On mobile: guaranteed stutter, battery drain, storage wear.

**Fix**: a separate object store for progress (`{chapterId, lastPage, done}`), writing only
that. Ideally in `requestIdleCallback` or debounced 500 ms.

### 2.2 AniList pacing exceeds the API limit, and a lost seed stays lost

AniList: 30 requests/minute. The code waits `sleep(700)` (`index.html:432`, `index.html:1689`)
→ ~85 req/min. The 429 is caught properly (`gql` sets `cooldownUntil`), but in `runDiscover`:

```js
catch(e){ failures++; …; continue; }
```

The series is **permanently skipped for that run**. On a 50-seed analysis, most fall into 429
after the first 30 and never enter the cross-reference. The displayed result is silently
incomplete.

**Fix**: a real scheduler (queue, 2.1 s between requests, exponential retry on 429 respecting
`Retry-After`). Same for MangaDex (`mdBatch` makes 2 requests per series every 320 ms ≈ 6 req/s,
past their limit).

### 2.3 `runDiscover` cannot be cancelled

With `state.seeds = "All"` over 800 series: `999` seeds × (request + 700 ms) ≈ **20 minutes**,
button disabled, no Stop button, and switching tabs does not stop it.

### 2.4 The `.tachibk` parser blocks the main thread, in BigInt

`pbParse` (`index.html:557`) uses `BigInt` for **every varint**, including field tags.
A backup of 800 series × ~200 chapters = ~160,000 nested messages, i.e. millions of BigInt
allocations. The tab freezes during import, with no real progress indicator.

Same for `readZip` → `inflateRaw`: one `Blob` + one `Response` + one `DecompressionStream`
**per page**, sequentially.

**Fix**: `Number` for varints < 2^53 (fall back to BigInt only if an 8th byte arrives), and
move parsing into a Web Worker. This is the textbook worker case.

### 2.5 Storage leak on deleted series

`removeBtn` removes the entry from `LIB.entries` and nothing else. Left in the database,
forever: that series' IndexedDB chapters (potentially hundreds of MB), `META[key]`,
`MDCACHE[key]`, `reco:v3:key`, and the `FSPROG` entries.

### 2.6 `pickDownloadFolder` freezes the interface

`indexPickedFiles` (`index.html:1041`) iterates synchronously over the entire `FileList`.
A complete `Mihon/downloads` folder is easily 100,000 files. The `await sleep(20)` placed
before it changes nothing: the loop that follows is blocking.

### 2.7 Right-to-left mode is on by default for everything

`index.html:1352` — `store.get("rtl:v1") !== false && mode === "paged" && entry.m !== "Webtoon"`.

A manhwa read in Paged mode (a common case: completed manhwa ship as paginated CBZ) starts in
Japanese reading order. The default should follow `typeOf(d)`: RTL for `Manga` (JP) only.

### 2.8 Escape closes the sheet underneath the reader

The reader listens on `el.onkeydown` on a `div` with `tabIndex=-1`. As soon as focus leaves
(clicking the image does it), the `document` listener at `index.html:1631` receives the key:
it closes the **sheet** and leaves the reader hanging over nothing. Same cause for the ← →
arrows, which stop working.

**Fix**: a `document`-level listener with a modal layer stack (reader > sheet > modal).

---

## 3. Architecture

### 3.1 What actually blocks progress ✅ *partially addressed*

- **No version control.** `git` is not initialised. A 100 KB file, no history, no way back.
  This is issue number one.
- **The project lives in `G:\Mon Drive\`** (Google Drive Desktop). A `.git` repo inside a
  synced folder gets corrupted sooner or later (Drive rewrites `.git/objects` files mid-operation).
  Move it local, with GitHub as the sync.
- **One file, 1,670 lines of JS.** For Claude Code this is the worst format: every change
  reloads 100 KB of context and the diffs are unreadable. Splitting it is what will speed up
  the work most from here on.
- **Zero tests.** Yet there is pure, perfectly testable logic here that *fails silently* when
  wrong: `pbParse`, `readZip`, `totals`, `chapNumOf`, `norm`, `rankTally`, `indexPickedFiles`,
  `srcKey`. Exactly the kind of code where one test is worth ten readings — bugs 1.1 and 1.6
  above would both have been caught by six lines of test.

> ✅ **Done 2026-08-23** — moved to `C:\dev\rayon-app`, git initialised, public GitHub repo,
> continuous deploy via Pages. The single-file and zero-test problems remain, and they are
> now the main brake: `norm()` was fixed only because it could be exercised in a live browser.

### 3.2 Rendering performance

- `renderLibrary()` rebuilds the **entire** grid `innerHTML`, then reattaches one `onclick`
  per card. Over 800 series, on every keystroke in the search box (`index.html:1878`, no
  debounce). → 150 ms debounce + event delegation.
- `refreshTracker()` (`index.html:1493`) calls `saveLib(); renderLibrary(); boot();` on
  **every click on `+`**. So: `JSON.stringify` of the whole library, rebuild of `OWNED`,
  rebuild of the entire grid, **and** rebuild of the filter chips (resetting their horizontal
  scroll). To increment a counter.
- `norm()` is called thousands of times per render (`typeOf`, `totals`, `progressOf`,
  `libRows`, `posterHTML`…) and redoes `normalize("NFD")` plus two regexes each time.
  A memoisation `Map`, or better the stable key from 1.1, solves both problems at once.
- `updateFilterSummary()` calls `libRows()`, and `renderLibrary()` calls it a second time.
- `boot()` → `draw()` computes `shelfTest` for 6 shelves × N entries, and `shelfTest` calls
  `progressOf` → `totals` → 2 `norm()`. That is ~10,000 `norm()` for 800 series, on every
  `boot()`.

### 3.3 Debatable design points (not bugs)

- `state` is only half persisted: `unit`, `seeds`, `panel` survive; `view`, `shelf`, `source`,
  `sort`, `libType` do not. Inconsistent from the user's point of view.
- `state.hideOwned` is wired in `fillRecos` but no UI changes it. Dead setting.
- `libRows()` sorts "Progress" on `b.r/(b.n||1)`, using the raw `n` from import — while the
  card displays the percentage derived from `totals()`. Sort does not match display.
- `renderChapters` concatenates `stored + fsList + pfList` with no deduplication: a chapter
  present via both the FS handle **and** the picked folder appears twice.
- `alert` / `confirm` / `prompt` (import, removal, total entry, chapter chaining). In a
  `standalone` PWA this looks broken, and on iOS `prompt` is sometimes blocked. Replace with
  the in-house dialogs (the `.modal` CSS already exists).
- `openAddModal` does not set `document.body.style.overflow = "hidden"` although `openSheet`
  does: the background scrolls behind the add modal.

---

## 4. PWA, offline, network

| Point | State | Action |
|---|---|---|
| `CACHE = "rayon-v1"` frozen | ✅ fixed | versioned, `index.html` network-first |
| `start_url: "./index.html"` | ✅ fixed | now `"./"` — otherwise `/` and `/index.html` are two distinct cache entries |
| `manifest.id` missing | ✅ fixed | stable `id` added |
| `screenshots` missing | minor | Chrome shows a much richer install prompt with them |
| AniList cover cache | unbounded | grows without limit; LRU eviction or a separate purgeable `Cache` |
| Google Fonts | external dependency | see §5 |
| Missing `DecompressionStream` | clear message ✓ | handled well |

On **MangaDex**: the README's caveat ("I could not test the CORS policy") can be lifted with a
single command. `api.mangadex.org` normally returns `Access-Control-Allow-Origin: *` — browser
calls go through. It is the image CDN (`uploads.mangadex.org`) that is restricted, and the app
does not use it. Verify once from the browser, then correct the docs: it removes a pointless doubt.

A deeper remark: `translatedLanguage[]=en` is hard-coded while the app is in French.
"Latest translated chapter" therefore means "in English". Make it configurable, or at minimum
say so in the interface.

---

## 5. Privacy: one claim to correct

The README said: *"nothing is sent anywhere, apart from the titles queried against AniList"*,
and the app footer: *"No data is sent elsewhere."*

That is inaccurate. `index.html:15` loads a stylesheet from `fonts.googleapis.com`, which then
pulls files from `fonts.gstatic.com`. Google therefore receives every user's IP address and
`User-Agent` on every open. Third-party requests in total: AniList (titles), MangaDex (titles),
the AniList image CDN (covers), Google Fonts (IP).

**Fix**: self-host the three fonts (`.woff2`, ~120 KB total with a Latin subset). Triple
benefit — the claim becomes true, first paint is no longer blocked by a third party, and
offline mode works from the first open instead of the second. Add `referrerpolicy="no-referrer"`
on cover `<img>` tags.

On application security, nothing alarming: `esc()` covers `& < > "`, all generated attributes
are double-quoted, outbound links carry `rel="noreferrer"`, no `eval`, no `innerHTML` fed by an
unescaped network response. A CSP is missing
(`default-src 'self'; connect-src https://graphql.anilist.co https://api.mangadex.org; img-src 'self' blob: https:`)
— useful as a net, not as an emergency.

---

## 6. Accessibility

- **Insufficient contrast.** `--dim: #726F5F` on `--paper: #D9D7CA` gives **3.49:1**
  (AA requires 4.5:1 for normal text). That is the colour of `.rmeta`, `.statusline`, `.sub`,
  `.lm`, `.cm`, `.filtersum`, `.prov`, `.empty` — that is, **all** secondary typography,
  displayed at 9.5–10 px on top of it. Darkening to ~`#5A5849` (≈ 5.5:1) changes nothing
  aesthetically and makes the text readable.
- **Tab semantics are wrong.** `<nav role="tablist">` contains three `role="tab"`, but the
  third (`tabAdd`) opens a modal, never has `aria-selected`, and there is neither
  `aria-controls` nor `role="tabpanel"`. A screen reader announces a tab widget that is not
  one. → two real tabs plus a separate action button.
- **No focus trap** in `.sheet`, `.modal` or the reader: tabbing escapes to the page below.
  And focus is not returned to the originating card on close.
- **Reader tap zones** (`.zone.l` / `.zone.r`): `div`s with `onclick`, invisible to keyboard
  and assistive technology.
- **`aria-live` missing** on `#statusline` and `#discoverStatus`, which are the only feedback
  during operations lasting several minutes.

---

## 7. What is good, and must not be broken

Worth stating plainly, because this is the hard part and it succeeded:

- **The `.tachibk` decoding.** Protobuf read by hand, no schema, no dependency, identifying
  the right field numbers. Clean reverse engineering.
- **`readZip`.** Central directory parsing, `method === 0` (stored) handling, `__MACOSX`
  exclusion, natural numeric sort, MIME detection by extension. Correct on every point where
  people usually get it wrong.
- **The provenance cascade for totals** (`totals()` + `provenanceHTML`). Rare and honest: the
  app says *where the number came from* and warns when progress exceeds the known total.
  A design choice most trackers do not make.
- **Mihon folder matching** with `srcKey()` neutralising the language suffix
  (`Asura Scans (EN)` → `asurascans`), and path-suffix indexing to be indifferent to the depth
  of the chosen root. Well spotted.
- **The README**, which explains the `Android/data/` constraint. Documentation well above average.
- **The art direction.** Coherent, committed, no framework.

---

## 8. Levelling up with Claude Code

Ordered by value / effort. Phases 0 and 1 change everything; the rest follows.

> Execution order has since been revised — see the vault roadmap. In short: §1.2 and §1.6
> destroy user data *today* and now outrank the remaining half of §1.1, which became a quality
> issue once the unicode collision was fixed.

### Phase 0 — the foundation ✅ done 2026-08-23

1. **Move the project out of Google Drive** → `C:\dev\rayon-app`.
2. **`git init`**, `.gitignore`, first commit of the current state.
3. **Public GitHub repo** + continuous deployment (GitHub Pages).
4. **`CLAUDE.md`** at the root: conventions, invariants, commands, known traps.

### Phase 1 — split it up, changing nothing else

`index.html` → `src/` as ES modules, a Vite build reproducing **the same single file** as
output (`vite-plugin-singlefile`) so nothing is lost of "it works by opening the file".

```
src/
  core/     norm.js  key.js  store.js  storage-idb.js
  data/     anilist.js  mangadex.js  mangabaka.js  rate-limiter.js
  import/   tachibk.js  tachibk.worker.js  cbz.js
  fs/       mihon-folder.js  picked-folder.js
  ui/       library.js  sheet.js  reader.js  discover.js  tracker.js  chips.js
  state.js  boot.js
```

Mechanical split, no redesign: move code, do not improve it yet. One commit per module,
verifiable by eye.

### Phase 2 — the tests that matter

Vitest on pure logic only. About ten files, roughly an hour:

- `norm` / `keyOf`: the CJK cases from §1.1;
- `chapNumOf`: the table from §1.6 as a case table;
- `totals`: the priority cascade, with the README matrix as the specification;
- `readZip`: a minimal CBZ fixture (stored + deflate);
- `pbParse`: an anonymised 3-series `.tachibk`;
- `rankTally`, `srcKey`, `indexPickedFiles`.

Then a single Playwright smoke test: load the app, import a JSON fixture, open a sheet,
increment, remove. It would have caught bug 1.4.

### Phase 3 — the fixes, in this order

See the vault roadmap for the current order.

### Phase 4 — Claude Code tooling

- `.claude/settings.json`: allow `npm run test`, `npm run build`, `git status/diff`
  → far fewer interruptions.
- A project *skill* `/rayon-fixture` generating a test `.tachibk` from JSON.
- A `PostToolUse` hook on `Edit` running `npx vitest related` on touched files.
- `/code-review` before every merge.

### What I do not recommend

- **No React / framework.** The app is too small and the current declarative rendering, once
  debounced and delegated, is plenty. Migrating would cost weeks for zero user gain.
- **No TypeScript yet.** Reconsider after phase 2. JSDoc + `checkJs` in `jsconfig.json` gives
  80% of the benefit for 5% of the cost, with no compile step.
- **No backend.** The absence of a server is the product's best argument. The one case that
  would justify one — a MangaDex relay — is not necessary (see §4).

---

## Executive summary

| # | Subject | Severity | Effort | State |
|---|---|---|---|---|
| 1.1 | Non-Latin titles → empty key | Blocking | M | ✅ collision fixed, stable key pending |
| 1.2 | `localStorage` fills silently | Blocking | M | open |
| 1.3 | Service worker never updates | Blocking | S | ✅ fixed |
| 1.4 | "Remove" dead after `refreshTracker` | High | XS | open |
| 1.5 | Import overwrites without confirmation | High | S | open |
| 1.6 | `chapNumOf` → progress jumps to 2024 | High | S | open |
| 2.1 | IndexedDB write per page turn | High | S | open |
| 2.2 | API pacing + seeds lost on 429 | High | M | open |
| 2.4 | Blocking BigInt parsing | Medium | M | open |
| 2.5 | Storage leak on removal | Medium | S | open |
| 5 | Google Fonts ≠ "nothing is sent" | Medium | S | open |
| 6 | 3.49:1 contrast on all secondary text | Medium | XS | open |
