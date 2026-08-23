/* Late binding, to break the UI's dependency cycles.
 *
 * The tangle this solves: the library grid opens a series sheet, the sheet's tracker changes
 * progress, and changing progress has to re-render the grid. Import the modules directly and
 * library → sheet → tracker → library is a cycle. Threading a callback through five
 * signatures would work but spreads the plumbing everywhere.
 *
 * Instead there is exactly ONE thing every UI module ever needs from "above": *the library
 * changed, redraw*. It is registered once by main.js at boot, and called by name from
 * anywhere — no module has to import the one that owns rendering.
 *
 * Deliberately minimal: this is not an event bus and should not grow into one. If a second
 * kind of notification is ever needed, add a second named function rather than a generic
 * emit(), so the call sites stay greppable.
 */

let handler = () => {};

/* Called once, by main.js, with the real implementation. */
export function onLibraryChanged(fn){ handler = fn; }

/* Called by any UI module after it mutates the library. */
export function libraryChanged(){ handler(); }

/* The second notification, added by name rather than by growing the above into an emit():
   the Discover pool changed, so its filter chips need recounting. Fires when a run finishes and
   when a title is dismissed or added — anything that changes what the chips are counting. */
let discoverHandler = () => {};
export function onDiscoverChanged(fn){ discoverHandler = fn; }
export function discoverChanged(){ discoverHandler(); }
