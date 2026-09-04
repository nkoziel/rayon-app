# Chapter and volume totals, and where they come from

There is no single reliable source for "how many chapters have been released". Every database
answers a slightly different question, and several of them decline to answer at all for an
ongoing series.

Rather than pick one and hide the difference, Rayon applies a cascade and **prints the
provenance under the counter**: which source the figure came from, and what that source's number
actually means.

## The cascade

Each source overrides the ones above it.

| Priority | Source | What its number is worth |
|---|---|---|
| 1 | **Your manual entry** | Always authoritative. *Set the total* button. |
| 2 | **MangaBaka** | Publication counts aggregated across up to seven databases. Fills in **ongoing** series, which is AniList's blind spot. The default answer for most titles. |
| 3 | **AniList** | `chapters` and `volumes` are only filled in for **completed** series. For an ongoing one these fields are empty — a database limitation, not a bug, and the cascade must not read that emptiness as zero. |
| 4 | **MangaDex** | The latest *translated* chapter, plus the volume split. A different question from "what has been published": Berserk showed 386 chapters here when 401 exist. Good coverage for Japanese manga, patchy for manhwa. *Check releases* button. |
| 5 | **Your Mihon backup** | The chapter count at your reading source. Often the most current figure for weekly series, but it counts duplicates and split chapters. |

The order was originally wrong — MangaDex sat above AniList — which understated totals for every
finished series. Measured over six titles, MangaDex yields a usable chapter maximum in 2 cases
and a volume structure in 1, and nothing at all for the manhwa.

## What that means in practice

- **Ongoing Japanese manga** (Kingdom, Sakamoto Days…): MangaBaka has a count; MangaDex adds the
  latest translated chapter and the volume split. Scanlation numbering sometimes differs from the
  official one, so the app warns you when your progress runs past the known total instead of
  silently capping it.
- **Completed series**: every source agrees. Nothing to think about.
- **Webtoons and manhwa**: often no volume split exists — they are not published in print volumes
  at all. Volume mode says "no volume split known", which is the correct answer, not a failure.
  Chapter tracking still works.
- **A series no database lists**: enter the total by hand. Two clicks, and it outranks everything
  from then on.

*Derive from my chapters* converts chapter progress into a volume count using the MangaDex volume
split, when one exists.

## Chapters and volumes are different axes

Chapter tracking measures **reading**. Volume tracking measures **the physical collection** — the
volume grid records what you *own*, not what you have read. A volume bought unread and a volume
read on a borrowed copy are different facts, and the two counters are deliberately independent.

The unit is per-series; the toolbar button only sets the default for series that have not chosen
one.

## Other technical notes

- **Mihon / Tachiyomi backups**: `.tachibk` is a gzip-compressed protobuf, decoded in the browser
  via `DecompressionStream`. Chrome, Edge, Firefox 113+, Safari 16.4+.
- **MangaBaka**: the metadata backbone. Base URL is `api.mangabaka.org`, batched 50 ids per
  request and cached server-side, so a 300-series library is six requests rather than three
  hundred. Licensed CC BY-NC-SA 4.0 — attribution is required and the project stays
  non-commercial.
- **AniList**: public GraphQL API, no key, 30 requests per minute. Used as a fallback, because it
  returned `403 — temporarily disabled` for a stretch of this project and it was then the app's
  only source. A library app whose single source can be switched off is one outage from useless.
- **MangaDex**: `api.mangadex.org` allows browser calls; its image CDN does not, which is why
  covers come from elsewhere.
- **Storage**: `localStorage` holds only your library and preferences. Records, MangaDex data and
  recommendation caches live in IndexedDB, because they used to overflow the ~5 MB localStorage
  quota and silently stop the library from being saved at all.
