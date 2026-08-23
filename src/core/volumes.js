/* Which printed volumes you actually own.
 *
 * Stored as a RANGE STRING on the entry: "1-7,9,12-14".
 *
 * Why not an array of booleans, or a Set: this is per-series data across a whole library, and
 * localStorage is capped at roughly 5 MB for the origin. Forty booleans times several hundred
 * series is exactly the growth that used to make the library silently stop saving
 * (REVIEW.md §1.2). A range string is compact, diff-friendly, survives the JSON export
 * unchanged so a collection can be handed to someone else, and is readable if anyone ever
 * inspects it by hand.
 *
 * Owning is NOT the same axis as reading — see the note in ui/tracker.js. A volume you own
 * unread and a volume you read borrowed are different facts.
 */

/* "1-7,9,12-14" -> [1,2,3,4,5,6,7,9,12,13,14]. Tolerant of junk: anything unparseable is
   dropped rather than throwing, because this value can come back from an imported file. */
export function parseVolumes(str){
  if (!str || typeof str !== "string") return [];
  const out = new Set();
  for (const part of str.split(",")){
    const p = part.trim();
    if (!p) continue;
    const m = p.match(/^(\d+)\s*-\s*(\d+)$/);
    if (m){
      let a = parseInt(m[1], 10), b = parseInt(m[2], 10);
      if (a > b) [a, b] = [b, a];              // "7-1" means the same as "1-7"
      if (b - a > 5000) continue;               // refuse an absurd range rather than hang
      for (let i = a; i <= b; i++) out.add(i);
      continue;
    }
    const n = parseInt(p, 10);
    if (Number.isFinite(n) && n > 0) out.add(n);
  }
  return [...out].sort((x, y) => x - y);
}

/* [1,2,3,5] -> "1-3,5". Always the shortest form, so the stored value is canonical and two
   equal collections compare equal as strings. */
export function formatVolumes(list){
  const nums = [...new Set((list || []).filter(n => Number.isFinite(n) && n > 0))].sort((a,b)=>a-b);
  const parts = [];
  let start = null, prev = null;
  for (const n of nums){
    if (start === null){ start = prev = n; continue; }
    if (n === prev + 1){ prev = n; continue; }
    parts.push(start === prev ? String(start) : `${start}-${prev}`);
    start = prev = n;
  }
  if (start !== null) parts.push(start === prev ? String(start) : `${start}-${prev}`);
  return parts.join(",");
}

export const ownsVolume = (str, n) => parseVolumes(str).includes(n);

export function toggleVolume(str, n){
  const owned = parseVolumes(str);
  const i = owned.indexOf(n);
  if (i === -1) owned.push(n); else owned.splice(i, 1);
  return formatVolumes(owned);
}

/* Add a whole run at once — "I own 1 to 12" should be one gesture, not twelve taps. */
export function addRange(str, from, to){
  const owned = parseVolumes(str);
  const [a, b] = from <= to ? [from, to] : [to, from];
  for (let i = a; i <= b; i++) owned.push(i);
  return formatVolumes(owned);
}

export const countVolumes = str => parseVolumes(str).length;

/* The volumes between 1 and `total` that are not owned — the shopping list for one series.
   Returns [] when no total is known: we do not guess how many volumes exist. */
export function missingVolumes(str, total){
  if (!total || total < 1) return [];
  const owned = new Set(parseVolumes(str));
  const out = [];
  for (let i = 1; i <= total; i++) if (!owned.has(i)) out.push(i);
  return out;
}

/* A gap is a volume you are missing BELOW something you already own — the hole in the middle
   of a shelf, which is usually what you want to close first. */
export function gapVolumes(str){
  const owned = parseVolumes(str);
  if (owned.length < 2) return [];
  const have = new Set(owned);
  const out = [];
  for (let i = owned[0]; i < owned[owned.length - 1]; i++) if (!have.has(i)) out.push(i);
  return out;
}

/* Complete means: a total is known, and nothing between 1 and it is missing. */
export const isComplete = (str, total) => !!total && missingVolumes(str, total).length === 0;
