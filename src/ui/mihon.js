/* Handing a title over to Mihon. Rayon reads nothing itself.
 *
 * Mihon's MainActivity declares an exported action for exactly this — verified against its
 * source, not guessed:
 *
 *   const val INTENT_SEARCH       = "eu.kanade.tachiyomi.SEARCH"
 *   const val INTENT_SEARCH_QUERY = "query"
 *
 * which pushes GlobalSearchScreen(query), the cross-source search.
 *
 * Targets OFFICIAL Mihon explicitly. Pinning the package makes the hand-off deterministic —
 * no app chooser — and if Mihon is absent the browser_fallback_url takes over. Forks are
 * deliberately not targeted.
 */

const MIHON_PACKAGE = "app.mihon";
const FALLBACK_URL = "https://mihon.app/";

const isAndroid = () => /android/i.test(navigator.userAgent);

/* There is no way to ask the browser whether an app is installed — deliberately, since it
   would be a fingerprinting vector. So this is a CAPABILITY check, not a presence check:
   show the button where the intent can work, and let the fallback handle the rest. */
export const mihonAvailable = () => isAndroid();

export function openInMihon(title){
  const url = "intent://#Intent;action=eu.kanade.tachiyomi.SEARCH"
    + ";package=" + MIHON_PACKAGE
    + ";S.query=" + encodeURIComponent(title)
    + ";S.browser_fallback_url=" + encodeURIComponent(FALLBACK_URL)
    + ";end";
  window.location.href = url;
}
