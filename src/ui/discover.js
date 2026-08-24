/* Discover: cross-references recommendations, seeded from what you read.
 *
 * This used to call AniList's loadRecos directly, while the detail sheet had already been moved
 * to recosFor(). Two recommendation paths, two different answers for the same question.
 *
 * recosFor() prefers MangaBaka and keeps AniList as the fallback. That matters for two reasons.
 * AniList went dark with a 403 for a stretch of this project and Discover had no second source
 * to fall back on — it is answering again today, which is exactly why the fallback should be
 * arranged while it works rather than during the next outage. And MangaBaka says WHY: shared
 * tags, shared readers, same author, instead of a bare vote count.
 *
 * Still paced by sleep(700), and a series that fails is skipped for the whole run rather than
 * retried — REVIEW.md §2.2 and §2.3. */

import { $, esc, toast, sleep } from '../core/dom.js';
import { MEDIA_TYPE } from './library.js';
import { norm } from '../core/norm.js';
import { LIB, DISCOVER, setDiscover, DISMISSED, saveDismissed, state, isOwned } from '../core/state.js';
import { kvSet } from '../core/store.js';
import { t as T } from '../core/i18n.js';
import { recosFor } from '../data/recos.js';
import { whyHTML, mergeWhy, strengthOf, signalsOf } from './why.js';
import { addFromMedia } from './add.js';
import { openPreview, openSheet } from './sheet.js';
import { discoverChanged } from './refresh.js';

/* MangaBaka items carry `mb`; their AniList `id` is often null, so keying the tally on `id`
   alone would collapse every unmatched series onto the same bucket. */
const keyOf = r => String(r.mb ?? r.id);

export async function runDiscover(){
  const btn = $("runDiscover");
  const bar = $("discoverProgress");
  btn.disabled = true; bar.classList.remove("hidden");
  // une série par titre exact d'abord (fonctionne même avant l'hydratation AniList),
  // puis fusion des variantes de titre qui pointent vers la même fiche une fois l'identifiant connu
  const byTitle = new Map();
  LIB.entries.filter(d => d.r > 0 || d.origin === "manuel").forEach(d => {
    const k = norm(d.t);
    const prev = byTitle.get(k);
    if (!prev || (d.r||0) > (prev.r||0)) byTitle.set(k, d);
  });
  const byAl = new Map();
  for (const d of byTitle.values()){
    const k = d.al ? "al:"+d.al : "t:"+norm(d.t);
    const prev = byAl.get(k);
    if (!prev || (d.r||0) > (prev.r||0)) byAl.set(k, d);
  }
  const limit = state.seeds === "all" ? 999 : state.seeds;
  const seeds = [...byAl.values()].sort((a,b)=> (b.r||1) - (a.r||1)).slice(0, limit);
  if (!seeds.length){
    $("discoverBox").innerHTML = `<p class="note">${esc(T("discover.needSeeds"))}</p>`;
    btn.disabled = false; bar.classList.add("hidden"); return;
  }
  const tally = new Map();
  let failures = 0;
  $("discoverStatus").textContent = T("discover.queueing", { n: seeds.length, min: Math.ceil(seeds.length*1.4/60) });
  for (let i=0;i<seeds.length;i++){
    $("discoverStatus").textContent = `${i+1}/${seeds.length} · ${seeds[i].t}`;
    bar.firstElementChild.style.width = Math.round((i)/seeds.length*100)+"%";
    let payload;
    try{ payload = await recosFor(seeds[i], false); }
    catch(e){ failures++; $("discoverStatus").textContent = e.message; await sleep(1200); continue; }
    payload.items.forEach(r=>{
      if (isOwned(r)) return;
      const k = keyOf(r);
      const prev = tally.get(k);
      /* A recommendation coming off a series you have read a lot of counts for more. */
      const weight = Math.max(1, seeds[i].r || 1);
      const s = strengthOf(r);
      if (prev){
        prev.votes += s;
        prev.weight += s*Math.log10(weight+10);
        /* Same title reached from two seeds: keep both sets of evidence, not just the first. */
        prev.why = mergeWhy(prev.why, r.why);
        if (!prev.from.some(x => norm(x) === norm(seeds[i].t))) prev.from.push(seeds[i].t);
      }
      else tally.set(k, Object.assign({}, r, {votes: s, from:[seeds[i].t], weight: s*Math.log10(weight+10)}));
    });
    renderDiscover(rankTally(tally), true);
    await sleep(700);
  }
  bar.firstElementChild.style.width = "100%";
  setDiscover({ at: new Date().toISOString(), seeds: seeds.map(s=>s.t), items: rankTally(tally).slice(0,60) });
  kvSet("discover:v1", DISCOVER);
  $("discoverStatus").textContent = failures ? T("discover.doneWithFailures", { n: failures }) : T("discover.done");
  bar.classList.add("hidden");
  btn.disabled = false;
  renderDiscover();
  discoverChanged();
  $("tabDiscN").textContent = visibleDiscover().length || "—";
}

function rankTally(tally){
  const seen = new Map();
  for (const r of tally.values()){
    const k = norm(r.romaji || r.titre);
    const prev = seen.get(k);
    if (prev){
      prev.votes += r.votes; prev.weight += r.weight;
      prev.why = mergeWhy(prev.why, r.why);
      r.from.forEach(f => { if (!prev.from.some(x=>norm(x)===norm(f))) prev.from.push(f); });
    } else seen.set(k, r);
  }
  return [...seen.values()].sort((a,b)=> b.from.length-a.from.length || b.weight-a.weight);
}

/* MangaBaka has no "webtoon" type - a canonical webtoon like Omniscient Reader is typed
   `manhwa`, and "webtoon" appears in neither its genres nor its tags. So the chip means the
   vertical-scroll colour formats, manhwa and manhua, which is what someone filtering for
   webtoons is after. The library tab's own webtoon filter is a different thing: it reads
   Mihon's reading mode, which recommendations do not have. */
export function typeTest(r){
  if (state.type === "all") return true;
  if (state.type === "webtoon") return r.type === "Manhwa" || r.type === "Manhua";
  return r.type === MEDIA_TYPE[state.type];
}

/* Not dismissed, not already owned. The chips filter on top of this, and the chip counts are
   taken from it so a chip never advertises titles the list cannot show. */
export function discoverPool(){
  return DISCOVER ? DISCOVER.items.filter(r => !DISMISSED.has(keyOf(r)) && !isOwned(r)) : [];
}

export function visibleDiscover(){
  if (!DISCOVER) return [];
  return discoverPool().filter(r=>{
    if (!typeTest(r)) return false;
    if (state.dwhy !== "all" && !signalsOf(r)[state.dwhy]) return false;
    return true;
  }).sort((a,b)=>{
    if (state.dsort === "score") return (b.score||0)-(a.score||0);
    if (state.dsort === "popularity") return (b.pop||0)-(a.pop||0);
    return b.from.length-a.from.length || b.weight-a.weight;
  });
}

function discoverCardHTML(r, i){
  const meta = [r.type, r.annee, r.chapitres?r.chapitres+" ch.":null, r.statut].filter(Boolean).join(" · ");
  return `<article class="reccard">
    ${r.cover?`<img class="cov" src="${esc(r.cover)}" alt="" loading="lazy">`:'<span class="ph"></span>'}
    <div class="body">
      <div class="rank">${String(i+1).padStart(2,"0")}${r.score?` · ${r.score}/100`:""}</div>
      <div class="rtitle"><button class="titlelink" data-open="${esc(keyOf(r))}">${esc(r.titre)}</button></div>
      <div class="rmeta">${esc(meta)}</div>
      <div class="rseed">${esc(T("discover.because", { seeds: r.from.slice(0,3).join(", ") }))}${r.from.length>3?` +${r.from.length-3}`:""}</div>
      <div class="rwhy">${whyHTML(r)}</div>
      <div class="ractions">
        <button class="btn sm" data-add="${esc(keyOf(r))}">${esc(T("reco.add"))}</button>
        <button class="btn sm ghost" data-skip="${esc(keyOf(r))}">${esc(T("discover.skip"))}</button>
      </div>
    </div>
  </article>`;
}

export function renderDiscover(partial, isPartial){
  if (state.tab !== "discover" && !isPartial) return;
  const box = $("discoverBox");
  const items = isPartial ? partial.filter(r=>!DISMISSED.has(keyOf(r))).slice(0,30) : visibleDiscover();
  if (!LIB.entries.length){
    box.innerHTML = `<p class="note">${esc(T("discover.emptyLib"))}</p>`;
    return;
  }
  if (!items.length){
    box.innerHTML = DISCOVER
      ? `<p class="note">${esc(T("discover.noneLeft"))}</p>`
      : `<p class="note">${esc(T("discover.intro"))}</p>`;
    return;
  }
  const seedLine = DISCOVER && !isPartial
    ? `<p class="note" style="margin-bottom:12px">${esc(T("discover.crossed", { n: DISCOVER.seeds.length, seeds: DISCOVER.seeds.join(", ") }))}</p>` : "";
  box.innerHTML = seedLine + `<div class="recgrid">${items.map(discoverCardHTML).join("")}</div>`;
  /* The title used to be a link to mangabaka.org - and to the wrong path, so it 404'd. A
     recommendation now opens the same sheet a series in the library opens: same layout, same
     recommendations, same record, with Add where the tracker would be. */
  [...box.querySelectorAll("[data-open]")].forEach(b=>{
    b.onclick = () => {
      const r = items.find(x=>keyOf(x)===b.dataset.open);
      if (!r) return;
      const mine = LIB.entries.find(x => norm(x.t) === norm(r.titre));
      if (mine) { openSheet(mine); return; }
      openPreview(r, () => { renderDiscover(); discoverChanged(); $("tabDiscN").textContent = visibleDiscover().length || "—"; });
    };
  });
  [...box.querySelectorAll("[data-add]")].forEach(b=>{
    b.onclick = () => {
      const r = items.find(x=>keyOf(x)===b.dataset.add);
      if (r && addFromMedia(r)){ renderDiscover(); discoverChanged(); }
    };
  });
  [...box.querySelectorAll("[data-skip]")].forEach(b=>{
    b.onclick = () => {
      /* String, not +string: keyOf() produces strings and a mixed Set never matches. */
      DISMISSED.add(b.dataset.skip);
      saveDismissed();
      renderDiscover();
      discoverChanged();
      $("tabDiscN").textContent = visibleDiscover().length || "—";
    };
  });
}
