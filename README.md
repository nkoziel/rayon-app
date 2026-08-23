# Rayon — manga library & recommendations

Standalone web app: a library of series, AniList metadata, progress tracking, and a
**Discover** tab that cross-references reader-voted recommendations. No account, no server —
everything is stored in your browser.

**Rayon does not read manga. [Mihon](https://mihon.app/) is the reader.** Each series sheet
has a *Chercher dans Mihon* button that hands the title straight to the app's cross-source
search. Rayon keeps track of what you read and helps you find what to read next.

**Live:** https://nkoziel.github.io/rayon-app/

## Folder contents

```
index.html              the built application — ONE self-contained file (generated)
src/                    the source: index.html shell, style.css, main.js
manifest.webmanifest    install metadata
sw.js                   service worker (offline support)
icons/                  192, 512, maskable, apple-touch icons
tools/                  build publish step and the verification harness
```

> **`index.html` at the root is generated. Edit `src/`, then run `npm run build`** — the build
> overwrites the root file. It is committed on purpose so the app stays openable straight from
> a clone, with no build step.

```bash
npm install
npm run build      # src/ -> one self-contained index.html at the root
npm run verify     # syntax + case tables, zero dependencies
npm run dev        # Vite dev server
```

## 1. Try it right now

Open `index.html` in a browser. Everything works except installation and offline mode,
which both require an `http(s)://` address — or just use the live URL above.

To load a library: **Import** (Mihon `.tachibk` backup or `.json` export), or the **Add**
tab to search AniList for titles one by one.

## 2. Hosting it yourself

Any static host works. Fastest options:

- **GitHub Pages** — already configured here: pushing to `main` publishes automatically.
- **Netlify Drop** — go to `app.netlify.com/drop`, drag the folder in, URL is immediate.
- **Cloudflare Pages**, **Vercel** — same idea.

One requirement: serve over HTTPS, otherwise the service worker will not register.

## 3. Installing on Android

Open the URL in Chrome → ⋮ menu → **Add to home screen**. The app launches fullscreen,
no address bar, with its icon. It starts offline; only AniList requests need the network.

On iPhone: Safari → Share → **Add to Home Screen**.

## 4. Building a real APK

Both routes start from the public URL.

### PWABuilder (nothing to install)

1. Go to `pwabuilder.com`, enter the app URL.
2. *Package for stores → Android*, pick **Signed APK** for direct sharing, or **App Bundle**
   for the Play Store.
3. Download the package and share the APK. Recipients must allow installation from unknown
   sources.

The APK is a *Trusted Web Activity*: an Android shell displaying the app fullscreen.

### Bubblewrap (command line) — the route actually used

An APK is already built and published this way: package `io.github.nkoziel.rayon`, ~0.9 MB.

```bash
npm install -g @bubblewrap/cli
bubblewrap init --manifest https://nkoziel.github.io/rayon-app/manifest.webmanifest
bubblewrap build          # produces app-release-signed.apk
```

Requires JDK 17 and the Android SDK, which Bubblewrap offers to install for you.

> **Digital Asset Links are set up.** For the APK to run without a Chrome address bar, Android
> requires `assetlinks.json` at the **domain root** — not at `/rayon-app/`. It is served from
> the separate [`nkoziel.github.io`](https://github.com/nkoziel/nkoziel.github.io) repository
> and validates against
> [Google's checker](https://developers.google.com/digital-asset-links/tools/generator).
> **If the app is ever re-signed with a different key, that file must be updated**, or the TWA
> silently falls back to showing the address bar.

> **On Windows, Bubblewrap has sharp edges.** It cannot be driven non-interactively, it wants
> the pre-2020 SDK layout, and it breaks on a JDK path containing spaces because it builds its
> `apksigner` command by string concatenation. The working configuration and each workaround
> are written up in the project roadmap.

### Capacitor (only if you want native later)

Worth it only if you plan to add native features (notifications, system share, file access
outside the browser):

```bash
npm install @capacitor/core @capacitor/cli
npx cap init Rayon com.example.rayon --web-dir=.
npx cap add android
npx cap open android      # build the APK from Android Studio
```

## Chapter tracking, and the matter of totals

Every series sheet has a tracking block: **Chapters / Volumes** toggle, a counter, "N left",
and a line stating **where the total came from**. The setting is per-series; the toolbar
button only sets the default.

There is no single reliable source for "how many chapters have been released". The app
therefore applies a cascade, in this order:

| Priority | Source | What it is worth |
|---|---|---|
| 1 | **Your manual entry** | Always authoritative. *Set total* button. |
| 2 | **MangaDex** | Volume structure and latest translated chapter. Good coverage for Japanese manga, partial for Asura or Flame manhwa. *Check releases* button. |
| 3 | **AniList** | `chapters` and `volumes` are only filled in for **completed** series. For an ongoing series these fields are empty — a database limitation, not a bug. |
| 4 | **Your Mihon backup** | The chapter count at your reading source. Often the most current figure for weekly series, but it counts duplicates and split chapters. |

Practical consequences:

- **Ongoing Japanese manga** (Kingdom, Sakamoto Days…): MangaDex gives the latest translated
  chapter and the volume split. Note that scanlation numbering sometimes differs from the
  official one; the app warns you when your progress exceeds the known total.
- **Completed series**: AniList is enough, its totals are correct.
- **Webtoons and manhwa**: often no volume split exists — they are not published in print
  volumes. Volume mode will show "no known split", which is normal. Chapter tracking remains.
- **Series missing from MangaDex**: manual entry. Two clicks, and the value takes priority
  from then on.

*Derive from my chapters* converts chapter progress into a volume count using the MangaDex
volume split.

**Open question**: direct browser calls to MangaDex (CORS policy) have not been verified from
this environment yet. If *Check releases* returns a blocking error, everything else keeps
working — AniList, your backup and manual entry cover the need.

## Handing a title to Mihon

On Android, every series sheet shows **Chercher dans Mihon**. It fires an Android intent that
Mihon declares for exactly this purpose (`eu.kanade.tachiyomi.SEARCH`), landing you in its
cross-source search with the title already filled in.

The button is hidden elsewhere: a browser cannot ask whether an app is installed — deliberately,
since that would be a fingerprinting vector — so it appears where the intent *can* work, and
falls back to mihon.app if nothing handles it. No package name is pinned, so forks of Mihon work
too.

## Sharing with others

- **The link is enough.** Everyone lands on an empty library, with a welcome screen
  explaining what to do.
- **Sharing a list**: **Export** → `.json` file. The other person loads it via **Import**.
  Handy for handing a selection to a friend.
- Nothing goes through a server: two people on the same URL have two independent libraries.

## Technical notes

- **Mihon / Tachiyomi backups**: `.tachibk` is a gzip-compressed protobuf, decoded in the
  browser via `DecompressionStream`. Chrome, Edge, Firefox 113+, Safari 16.4+.
- **AniList**: public GraphQL API, no key, limited to 30 requests per minute. The app batches
  its calls (50 entries per request) and caches everything.
- **Storage**: `localStorage` holds only your library and preferences. Metadata, MangaDex data
  and recommendation caches live in IndexedDB, because they used to overflow the ~5 MB
  localStorage quota and silently stop the library from saving at all. The JSON export is your
  only backup — redo it from time to time, and note that **Tout effacer** offers it first.
- **Privacy**: nothing is sent anywhere apart from the titles queried against AniList and
  MangaDex — **except** that the page currently loads its fonts from Google Fonts, which
  discloses your IP address to Google on every open. Self-hosting the fonts is planned.

## Documentation

- `REVIEW.md` — technical review, numbered findings (§1.1 to §6)
- `CLAUDE.md` — conventions and invariants for working on this codebase
