/* The shopping screen: which volumes are missing, so you know what to buy.
 *
 * The use case is specific and it drives every choice here: standing in a shop, offline,
 * needing an answer in two seconds. Everything renders from local state — no network call —
 * because a bookshop is exactly where signal is bad.
 *
 * Two lists, because they are genuinely different purchases:
 *   CONTINUE  you already own some and are missing others. Sorted by how close to complete,
 *             so a trip finishes something.
 *   START     you read it and own nothing of it. Deliberately kept apart, otherwise the
 *             wishlist drowns the gap-filling list.
 */

import { $, esc, toast } from '../core/dom.js';
import { norm } from '../core/norm.js';
import { LIB, saveLib, state } from '../core/state.js';
import { store } from '../core/store.js';
import { t as T, locale } from '../core/i18n.js';
import { totals, unitOf } from '../data/totals.js';
import { recordOf } from '../data/record.js';
import { parseVolumes, countVolumes, missingVolumes, gapVolumes, isComplete } from '../core/volumes.js';
import { openSheet } from './sheet.js';

/* No API gives reliable per-volume prices — not MangaBaka, not AniList, not MangaDex. So this
   is an honest estimate from a rate you set, not a fake precision. A French tankōbon runs
   about 7-8 euros. A series can override it for boxsets or deluxe editions. */
const PRICE_KEY = "volprice:v1";
export const defaultPrice = () => Number(store.get(PRICE_KEY)) || 7.5;
export const setDefaultPrice = v => store.set(PRICE_KEY, Number(v) || 7.5);
const priceOf = d => Number(d.volPrice) || defaultPrice();

/* Whether a series belongs in a shopping list.
   Undefined means "follow the unit": volumes are the physical axis, chapters the digital one,
   so a series tracked in chapters is not something you buy in a shop. An explicit true/false
   always wins — that is the include/exclude control. */
export function inShopping(d){
  if (d.shop === true) return true;
  if (d.shop === false) return false;
  return unitOf(d) === "vol";
}

export function toggleShopping(d){
  d.shop = !inShopping(d);
  saveLib();
}

/* One row of the shopping list, with everything needed to decide in a shop. */
function shoppingRow(d){
  const tot = totals(d).vol;
  const owned = countVolumes(d.ownedVol);
  const missing = missingVolumes(d.ownedVol, tot);
  const gaps = gapVolumes(d.ownedVol);
  return {
    d, tot, owned, missing, gaps,
    complete: isComplete(d.ownedVol, tot),
    cost: missing.length * priceOf(d),
    /* how close to finished, for sorting: a series missing one volume comes first */
    ratio: tot ? owned / tot : 0,
  };
}

export function shoppingRows(){
  const rows = LIB.entries.filter(inShopping).map(shoppingRow);
  /* Owned but not finished. The test is deliberately "not complete" rather than "has missing
     volumes": missingVolumes() returns [] when no total is published, so a series you own six
     of but whose length nobody has counted used to match NEITHER list and vanished from the
     screen entirely - while still counting towards the totals above it, which is what made it
     look like a rendering bug rather than a filter. No total is the normal state on a device
     whose metadata cache is still cold. It sorts last, since ratio is 0 without a total: the
     rows you can actually act on stay at the top. */
  const cont = rows.filter(r => r.owned > 0 && !r.complete)
                   .sort((a, b) => b.ratio - a.ratio);
  const start = rows.filter(r => r.owned === 0)
                    .sort((a, b) => (b.d.r || 0) - (a.d.r || 0));   // most-read first
  const done = rows.filter(r => r.complete);
  return { rows, cont, start, done };
}

const money = n => new Intl.NumberFormat(locale(), { style: "currency", currency: "EUR" }).format(n);

/* Compress a missing list for display: "4, 7-9, 12" reads faster than twelve numbers. */
function runs(list){
  const out = [];
  let a = null, prev = null;
  for (const n of list){
    if (a === null){ a = prev = n; continue; }
    if (n === prev + 1){ prev = n; continue; }
    out.push(a === prev ? String(a) : `${a}-${prev}`);
    a = prev = n;
  }
  if (a !== null) out.push(a === prev ? String(a) : `${a}-${prev}`);
  return out;
}

function rowHTML(r, showGaps){
  const meta = recordOf(r.d);
  const cover = meta && meta.cover;
  /* A hole below what you already own is usually the one to close first. */
  const gapBadge = showGaps && r.gaps.length
    ? `<span class="agree">${esc(T("shop.gap", { n: r.gaps.length }))}</span>` : "";
  return `<button class="shoprow" data-id="${esc(r.d.id)}">
    ${cover ? `<img src="${esc(cover)}" alt="" loading="lazy">` : '<span class="ph"></span>'}
    <span class="si">
      <span class="st">${esc(r.d.t)}</span>
      <span class="sm">${r.tot ? esc(T("shop.ownedOf", { n: r.owned, total: r.tot })) : esc(T("shop.ownedNoTotal", { n: r.owned }))}</span>
      ${r.tot ? `<span class="shelfbar thin"><span style="width:${Math.min(100, Math.round(r.owned / r.tot * 100))}%"></span></span>` : ""}
      ${r.missing.length ? `<span class="sv">${esc(T("shop.missing"))} ${esc(runs(r.missing).join(", "))}</span>` : ""}
    </span>
    <span class="sc">${r.missing.length ? esc(money(r.cost)) : ""}${gapBadge}</span>
  </button>`;
}

export function renderShopping(){
  const box = $("shopResults");
  if (!box) return;
  const note = $("shopPriceNote");
  if (note) note.textContent = T("shop.priceNote", { price: money(defaultPrice()) });
  const { rows, cont, start, done } = shoppingRows();

  if (!rows.length){
    box.innerHTML = `<p class="note">${esc(T("shop.empty"))}</p>`;
    $("shopStats").innerHTML = "";
    return;
  }

  const ownedTotal = rows.reduce((s, r) => s + r.owned, 0);
  const missingTotal = rows.reduce((s, r) => s + r.missing.length, 0);
  const costTotal = rows.reduce((s, r) => s + r.cost, 0);
  const valueOwned = rows.reduce((s, r) => s + r.owned * priceOf(r.d), 0);

  $("shopStats").innerHTML = [
    [ownedTotal, T("shop.volumesOwned")],
    [done.length + "/" + rows.length, T("shop.complete")],
    [missingTotal, T("shop.volumesMissing")],
    [money(valueOwned), T("shop.estimatedValue")],
  ].map(([v, l]) => `<div class="stat"><b>${esc(String(v))}</b><small>${esc(l)}</small></div>`).join("");

  const section = (title, list, note, showGaps) => !list.length ? "" : `
    <div class="seclabel"><span>${esc(title)}</span><span class="rmeta">${esc(note)}</span></div>
    ${list.map(r => rowHTML(r, showGaps)).join("")}`;

  box.innerHTML =
    section(T("shop.continue"), cont, T("shop.continueNote", { cost: money(costTotal) }), true)
    + section(T("shop.start"), start, T("shop.startNote"), false)
    + (done.length ? `<p class="note">${esc(T("shop.completeNote", { n: done.length }))}</p>` : "");

  [...box.querySelectorAll("[data-id]")].forEach(el => {
    el.onclick = () => openSheet(LIB.entries.find(x => x.id === el.dataset.id));
  });
}

/* The price is an estimate and the UI says so; this just lets you set the rate. */
export function askPrice(){
  const v = prompt(T("shop.pricePrompt"), String(defaultPrice()));
  if (v === null) return false;
  const n = parseFloat(String(v).replace(",", "."));
  if (!Number.isFinite(n) || n <= 0) return false;
  setDefaultPrice(n);
  toast(T("shop.priceSet", { price: money(n) }));
  return true;
}
