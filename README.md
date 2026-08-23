# Rayon — manga library & recommendations

Standalone web app: a library of series, AniList metadata, and a **Discover** tab that
cross-references reader-voted recommendations. No account, no server — everything is
stored in your browser.

**Live:** https://nkoziel.github.io/rayon-app/

## Folder contents

```
index.html              the application
manifest.webmanifest    install metadata
sw.js                   service worker (offline support)
icons/                  192, 512, maskable, apple-touch icons
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

> **Note on Digital Asset Links.** For the APK to run without a Chrome address bar, Android
> requires an `assetlinks.json` at the **domain root** — `https://nkoziel.github.io/.well-known/assetlinks.json`.
> Since this app is a project page served from `/rayon-app/`, that file belongs to a separate
> `nkoziel.github.io` repository. Without it the APK still works, but shows the address bar.

### Bubblewrap (command line)

```bash
npm install -g @bubblewrap/cli
bubblewrap init --manifest https://nkoziel.github.io/rayon-app/manifest.webmanifest
bubblewrap build          # produces app-release-signed.apk
```

Requires JDK 17 and the Android SDK, which Bubblewrap offers to install for you.

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

## Reading offline

Every sheet has an **Offline chapters** section. Drop files from your device — `.cbz`, `.zip`
or a selection of images — and they are stored in the browser (IndexedDB), available without
network.

The reader follows Mihon conventions:

- **Webtoon**: continuous vertical scroll, one image after another
- **Paged**: one page at a time, left/right tap zones, keyboard arrows, switchable
  **right-to-left** direction for Japanese manga
- Resumes on the page where you stopped
- "Mark as read" updates your progress: if the filename contains a number
  (`Chapter 145.cbz`, `one-piece-1102.cbz`), that number is recorded, otherwise progress
  advances by one
- Next chapter is offered at the end

Archives are decoded natively (`DecompressionStream`), with no external library. Accepted
formats: CBZ/ZIP containing JPEG, PNG, WebP, GIF or AVIF. CBR (RAR) is not supported —
convert it to CBZ.

### Linking your Mihon folder

**•••  → Mihon folder**. The app walks the `source / series / chapter` tree, matches it
against your library by title, and chapters appear in each sheet marked "Mihon folder".
Images are read **in place**, with no copy and no duplicated storage. Cards show an
"N offline" badge.

The folder stays linked between sessions; the browser asks for permission again on first read.

**The Android constraint, to fix once.** Since Android 11, no application — browsers
included — can open `Android/data/`, where Mihon stores downloads by default. The file
picker refuses that path; there is no way around it.

The fix is in Mihon: *Settings → Downloads → Download directory*, and pick an accessible
folder such as `Documents/Mihon` or a `Mihon` folder at storage root. New downloads go there,
and that folder the app can read. For already-downloaded chapters, move the old folder with a
file manager.

**On Android: pick the `Mihon/downloads` root in one go.**

**•••  → Mihon folder**, navigate to `Mihon/downloads` and confirm with *Use this folder*.
The app reads the whole tree and files each chapter under the right series:

```
downloads/Asura Scans (EN)/Absolute Regression/Ch. 115/001.jpg
           └── source ──┘  └──── series ────┘  └ chapter ┘
```

Matching uses the **source name from your backup** — "Asura Scans" finds "Asura Scans (EN)",
the language suffix is ignored — then the title. Failing that, the app falls back to the title
alone. Both image folders and `.cbz` files are supported; `.nomedia` and foreign files are
ignored.

A summary appears above the grid: number of series, chapters, recognised series, and the
breakdown by source.

| Context | What works |
|---|---|
| Chrome / Edge on desktop | Persistent handle to the root: access survives restarts |
| Chrome on Android | Root must be re-picked each session; a *Reopen folder* button is shown |
| Firefox, Safari | `.cbz` files or images, series by series, with a copy |

On Android the browser forgets the permission when the tab closes — a platform limitation,
not a setting. The inventory itself is kept: "N offline" badges stay visible, and one click
restores access.

You can also use your own scans or your open-format purchases.

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
- **Storage**: `localStorage`. Expect well over the original 300 KB estimate for a real
  library — a few hundred series with metadata and recommendation caches can approach the
  ~5 MB origin quota. The JSON export is your only backup — redo it from time to time.
- **Privacy**: nothing is sent anywhere apart from the titles queried against AniList and
  MangaDex — **except** that the page currently loads its fonts from Google Fonts, which
  discloses your IP address to Google on every open. Self-hosting the fonts is planned.

## Documentation

- `REVIEW.md` — technical review, numbered findings (§1.1 to §6)
- `CLAUDE.md` — conventions and invariants for working on this codebase
