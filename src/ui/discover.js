/* Discover: cross-references the recommendations readers voted on, seeded from what you read.
   Still paced by sleep(700) against AniList's 30 req/min, and a series that 429s is skipped
   for the whole run rather than retried — REVIEW.md §2.2 and §2.3. */

import { $, esc, toast, sleep } from '../core/dom.js';
import { norm } from '../core/norm.js';
import { LIB, DISCOVER, setDiscover, DISMISSED, saveDismissed, state, isOwned } from '../core/state.js';
import { kvSet } from '../core/store.js';
import { t as T } from '../core/i18n.js';
import { gql, RECO_Q, shapeMedia, loadRecos } from '../data/anilist.js';
import { addFromMedia } from './add.js';

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
  const limit = state.seeds === "Tout" ? 999 : state.seeds;
  const seeds = [...byAl.values()].sort((a,b)=> (b.r||1) - (a.r||1)).slice(0, limit);
  if (!seeds.length){
    $("discoverBox").innerHTML = `<p class="note">Ajoute d'abord quelques titres, puis relance l'analyse.</p>`;
    btn.disabled = false; bar.classList.add("hidden"); return;
  }
  const tally = new Map();
  let failures = 0;
  $("discoverStatus").textContent = `${seeds.length} séries à interroger · environ ${Math.ceil(seeds.length*1.4/60)} min`;
  for (let i=0;i<seeds.length;i++){
    $("discoverStatus").textContent = `${i+1}/${seeds.length} · ${seeds[i].t}`;
    bar.firstElementChild.style.width = Math.round((i)/seeds.length*100)+"%";
    let payload;
    try{ payload = await loadRecos(seeds[i], false); }
    catch(e){ failures++; $("discoverStatus").textContent = e.message; await sleep(1200); continue; }
    payload.items.forEach(r=>{
      if (isOwned(r)) return;
      const prev = tally.get(r.id);
      const weight = Math.max(1, seeds[i].r || 1);
      if (prev){
        prev.votes += r.votes;
        prev.weight += r.votes*Math.log10(weight+10);
        if (!prev.from.some(x => norm(x) === norm(seeds[i].t))) prev.from.push(seeds[i].t);
      }
      else tally.set(r.id, Object.assign({}, r, {from:[seeds[i].t], weight: r.votes*Math.log10(weight+10)}));
    });
    renderDiscover(rankTally(tally), true);
    await sleep(700);
  }
  bar.firstElementChild.style.width = "100%";
  setDiscover({ at: new Date().toISOString(), seeds: seeds.map(s=>s.t), items: rankTally(tally).slice(0,60) });
  kvSet("discover:v1", DISCOVER);
  $("discoverStatus").textContent = failures ? `Terminé · ${failures} série(s) sans fiche AniList` : "Analyse terminée";
  bar.classList.add("hidden");
  btn.disabled = false;
  renderDiscover();
  $("tabDiscN").textContent = visibleDiscover().length || "—";
}

function rankTally(tally){
  const seen = new Map();
  for (const r of tally.values()){
    const k = norm(r.romaji || r.titre);
    const prev = seen.get(k);
    if (prev){
      prev.votes += r.votes; prev.weight += r.weight;
      r.from.forEach(f => { if (!prev.from.some(x=>norm(x)===norm(f))) prev.from.push(f); });
    } else seen.set(k, r);
  }
  return [...seen.values()].sort((a,b)=> b.from.length-a.from.length || b.weight-a.weight);
}

export function visibleDiscover(){
  if (!DISCOVER) return [];
  return DISCOVER.items.filter(r=>{
    if (DISMISSED.has(r.id)) return false;
    if (isOwned(r)) return false;
    if (state.type !== "Tous" && r.type !== state.type) return false;
    return true;
  }).sort((a,b)=>{
    if (state.dsort === "Note") return (b.score||0)-(a.score||0);
    if (state.dsort === "Popularité") return (b.pop||0)-(a.pop||0);
    return b.from.length-a.from.length || b.weight-a.weight;
  });
}

function discoverCardHTML(r, i){
  const meta = [r.type, r.annee, r.chapitres?r.chapitres+" ch.":null, r.statut].filter(Boolean).join(" · ");
  return `<article class="reccard">
    ${r.cover?`<img class="cov" src="${esc(r.cover)}" alt="" loading="lazy">`:'<span class="ph"></span>'}
    <div class="body">
      <div class="rank">${String(i+1).padStart(2,"0")}${r.score?` · ${r.score}/100`:""}</div>
      <div class="rtitle"><a href="${esc(r.url)}" target="_blank" rel="noreferrer">${esc(r.titre)}</a></div>
      <div class="rmeta">${esc(meta)}</div>
      <div class="rwhy">Parce que tu lis <b>${esc(r.from.slice(0,3).join(", "))}</b>${r.from.length>3?` +${r.from.length-3}`:""} · ${r.votes} votes</div>
      <div class="ractions">
        <button class="btn sm" data-add="${r.id}">Ajouter</button>
        <button class="btn sm ghost" data-skip="${r.id}">Pas pour moi</button>
      </div>
    </div>
  </article>`;
}

export function renderDiscover(partial, isPartial){
  if (state.tab !== "discover" && !isPartial) return;
  const box = $("discoverBox");
  const items = isPartial ? partial.filter(r=>!DISMISSED.has(r.id)).slice(0,30) : visibleDiscover();
  if (!LIB.entries.length){
    box.innerHTML = `<p class="note">Ta bibliothèque est vide. Ajoute quelques titres depuis l'onglet <b>Ajouter</b>, ou importe une sauvegarde, puis lance l'analyse.</p>`;
    return;
  }
  if (!items.length){
    box.innerHTML = DISCOVER
      ? `<p class="note">Plus rien à proposer avec ces filtres. Change de type, réaffiche les écartés, ou relance l'analyse après avoir lu de nouveaux titres.</p>`
      : `<p class="note">Lance l'analyse : chaque série que tu lis est envoyée à AniList, et les titres qui reviennent depuis plusieurs d'entre elles remontent en tête.</p>`;
    return;
  }
  const seedLine = DISCOVER && !isPartial
    ? `<p class="note" style="margin-bottom:12px">Croisement de ${DISCOVER.seeds.length} séries : ${esc(DISCOVER.seeds.join(", "))}.</p>` : "";
  box.innerHTML = seedLine + `<div class="recgrid">${items.map(discoverCardHTML).join("")}</div>`;
  [...box.querySelectorAll("[data-add]")].forEach(b=>{
    b.onclick = () => {
      const r = items.find(x=>String(x.id)===b.dataset.add);
      if (r && addFromMedia(r)){ renderDiscover(); }
    };
  });
  [...box.querySelectorAll("[data-skip]")].forEach(b=>{
    b.onclick = () => {
      DISMISSED.add(+b.dataset.skip);
      saveDismissed();
      renderDiscover();
      $("tabDiscN").textContent = visibleDiscover().length || "—";
    };
  });
}
