# Installing Rayon on Android, and packaging it as an APK

Rayon is a PWA, so there are two ways onto a phone: install it from the browser, or wrap it in
an APK. The first needs nothing. The second is only worth it if you want to hand someone a file.

## Installing from the browser

Open [the app](https://nkoziel.github.io/rayon-app/) in Chrome → ⋮ menu → **Add to home screen**.
It launches fullscreen with no address bar, using its own icon, and starts offline — only
metadata lookups need the network.

On iPhone: Safari → Share → **Add to Home Screen**.

## Building an APK

Both routes start from the public URL, and both produce a *Trusted Web Activity*: an Android
shell displaying the app fullscreen.

### Bubblewrap — the route actually used

An APK is already published this way: package `io.github.nkoziel.rayon`, ~0.9 MB.

```bash
npm install -g @bubblewrap/cli
bubblewrap init --manifest https://nkoziel.github.io/rayon-app/manifest.webmanifest
bubblewrap build          # produces app-release-signed.apk
```

Requires JDK 17 and the Android SDK, which Bubblewrap offers to install for you.

> **Digital Asset Links are already set up — and they are re-signing-sensitive.**
> For the APK to run without a Chrome address bar, Android requires `assetlinks.json` at the
> **domain root**, not at `/rayon-app/`. It is served from the separate
> [`nkoziel.github.io`](https://github.com/nkoziel/nkoziel.github.io) repository and validates
> against [Google's checker](https://developers.google.com/digital-asset-links/tools/generator).
> **If the app is ever re-signed with a different key, that file must be updated with the new
> SHA-256 fingerprint**, or the TWA silently falls back to showing the address bar. It fails
> quietly, which is what makes it worth writing down.

> **On Windows, Bubblewrap has sharp edges.** It cannot be driven non-interactively, it wants
> the pre-2020 SDK layout, and it breaks on a JDK path containing spaces because it builds its
> `apksigner` command by string concatenation. The working configuration and each workaround are
> written up in the project roadmap.

### PWABuilder — nothing to install

1. Go to [pwabuilder.com](https://www.pwabuilder.com/), enter the app URL.
2. *Package for stores → Android*, pick **Signed APK** for direct sharing, or **App Bundle** for
   the Play Store.
3. Download the package and share the APK. Recipients must allow installation from unknown
   sources.

### Capacitor — only if you want native later

Worth it only if you plan to add native features (notifications, system share, file access
outside the browser):

```bash
npm install @capacitor/core @capacitor/cli
npx cap init Rayon com.example.rayon --web-dir=.
npx cap add android
npx cap open android      # build the APK from Android Studio
```

## Handing a title to Mihon

On Android, every series sheet shows **Search in Mihon**. It fires an Android intent that Mihon
declares for exactly this purpose (`eu.kanade.tachiyomi.SEARCH`), landing you in its cross-source
search with the title already filled in.

It targets the official Mihon package (`app.mihon`), so the hand-off is deterministic with no app
chooser. If Mihon is not installed, the button falls back to mihon.app.

Two things worth knowing:

- **Mihon appears in the share sheet as "Search"**, with its own icon — Android shows the
  activity name, not the app name. The sheet says so, because it looks like the wrong entry.
- **The button is hidden outside Android.** A browser cannot ask whether an app is installed —
  deliberately, since that would be a fingerprinting vector — so the button appears only where
  the intent can actually work.
