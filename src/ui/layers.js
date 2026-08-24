/* The Android back gesture, and what it should close.
 *
 * Nothing in this app ever pushed a history entry, so in the installed Android app back popped
 * the only entry there was and left the app entirely. Reported exactly that way: "I open a
 * series, press back out of habit to close it, and the whole app exits." On Android back is
 * how you dismiss things — it is not optional politeness to honour it.
 *
 * Every overlay pushes one history entry when it opens, and back pops it.
 *
 * The rule that keeps this honest: ALL teardown runs from the popstate handler, so there is
 * exactly one close path whether the user pressed back, tapped the scrim, hit Escape or used
 * the close button. A control that tore the overlay down directly would leave our history
 * entry behind, and the next back press would silently consume it and appear to do nothing —
 * which is worse than the bug being fixed, because it is intermittent.
 *
 * Deliberately not a router. Nothing here reads or writes the URL: the app is one page with no
 * shareable per-series address, and inventing one would put series titles in the location bar
 * of a page whose whole claim is that nothing leaves the browser.
 */

/* Teardown callbacks, innermost last. */
const stack = [];
let wired = false;

function wire(){
  if (wired) return;
  wired = true;
  window.addEventListener("popstate", () => {
    const teardown = stack.pop();
    if (teardown) teardown();
  });
}

/* Open an overlay: say how to tear it down, and give back something to pop. */
export function openLayer(teardown){
  wire();
  stack.push(teardown);
  history.pushState({ rayonLayer: stack.length }, "");
}

/* Swap what the current entry closes, without changing the history depth — one sheet opening
   another. Back then leaves the sheet rather than walking back through the chain, which is
   what the gesture means here: get me off this screen. */
export function replaceLayer(teardown){
  if (!stack.length) return openLayer(teardown);
  stack[stack.length - 1] = teardown;
}

/* Close from a control inside the app. Going through history is what consumes the entry we
   pushed; the popstate handler does the actual teardown. Returns false when no layer is open,
   so callers can fall back to closing directly. */
export function closeLayer(){
  if (!stack.length) return false;
  history.back();
  return true;
}

export const layerOpen = () => stack.length > 0;

/* Testing seam: the stack is module state and would otherwise leak between cases. */
export function resetLayers(){ stack.length = 0; }
