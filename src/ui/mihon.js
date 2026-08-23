/* Handing a title over to Mihon. Rayon reads nothing itself.
 *
 * This used to build an `intent://` URI for Mihon's own search action:
 *
 *   const val INTENT_SEARCH       = "eu.kanade.tachiyomi.SEARCH"
 *   const val INTENT_SEARCH_QUERY = "query"
 *
 * The constants were right and it still never worked — it always landed on the
 * browser_fallback_url, opening mihon.app in a tab. The reason is in Mihon's manifest, not in
 * its Kotlin:
 *
 *   <intent-filter>
 *     <action android:name="eu.kanade.tachiyomi.SEARCH" />
 *     <category android:name="android.intent.category.DEFAULT" />
 *   </intent-filter>
 *
 * A browser launching an intent: URI ALWAYS adds CATEGORY_BROWSABLE — that is the platform's
 * safeguard against a web page starting arbitrary activities. Mihon's search filter declares
 * only DEFAULT, so the intent cannot resolve and the fallback fires. Every browsable entry
 * point Mihon does declare (tachiyomi://add-repo, mihon://extension-store, the .tachibk
 * restore, the tracker auth callbacks) is something else entirely. There is no reachable
 * search deep link, and no wording of the URI changes that.
 *
 * What does work is the share sheet. MainActivity handles ACTION_SEND text/plain through the
 * same branch as its own search action:
 *
 *   Intent.ACTION_SEARCH, Intent.ACTION_SEND, "…SEARCH_ACTION" -> {
 *     val query = intent.getStringExtra(SearchManager.QUERY) ?: intent.getStringExtra(EXTRA_TEXT)
 *
 * and the Web Share API maps `text` onto EXTRA_TEXT. So sharing the title reaches exactly the
 * cross-source search the intent was aiming at. It costs one tap — picking Mihon in the sheet —
 * and unlike the intent it actually arrives.
 */

const isAndroid = () => /android/i.test(navigator.userAgent);

/* A capability check, not a presence check: there is no way to ask the browser whether an app is
   installed, deliberately, since it would be a fingerprinting vector. Show the button where the
   share sheet exists and let the user pick Mihon from it. */
export const mihonAvailable = () =>
  isAndroid() && typeof navigator.share === "function";

/* Resolves true when the sheet was shown. A user who dismisses it is not an error — AbortError
   is the normal way to say "changed my mind", so it must not surface as a failure. */
export async function openInMihon(title){
  try{
    await navigator.share({ text: title });
    return true;
  }catch(e){
    if (e && e.name === "AbortError") return false;
    throw e;
  }
}
