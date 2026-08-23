/* Adding a series by hand, from the AniList catalogue. */

import { $, esc, toast, uid, closeModal } from '../core/dom.js';
import { norm } from '../core/norm.js';
import { LIB, META, markMetaDirty, saveLib, saveMeta, isOwned } from '../core/state.js';
import { t as T } from '../core/i18n.js';
import { gql, shapeMedia, SEARCH_PAGE_Q } from '../data/anilist.js';
import { libraryChanged } from './refresh.js';

export function addFromMedia(m, opts){
  opts = opts || {};
  if (LIB.entries.some(e => (e.al && e.al===m.id) || norm(e.t)===norm(m.titre))){
    toast("Déjà dans ta liste"); return false;
  }
  LIB.entries.unshift({
    id: uid(), t: m.titre, a: m.auteur, s: opts.source || "Ajout manuel",
    st: m.statut || "Inconnu", g: m.genres.slice(0,6),
    r: opts.read || 0, ownedVol: "", n: m.chapitres || 0, d: "",
    ad: new Date().toISOString().slice(0,10), m: m.type === "Manhwa" ? "Webtoon" : "",
    al: m.id, f: 1, origin: "manuel"
  });
  META[norm(m.titre)] = m; markMetaDirty();
  saveLib(); saveMeta(); libraryChanged();
  toast("« "+m.titre+" » ajouté");
  return true;
}

export function openAddModal(prefill){
  $("modalHost").innerHTML = `
    <div class="modal" id="modalScrim">
      <div class="modalbox" role="dialog" aria-label="Ajouter un titre">
        <div class="modalhead">
          <h3>Ajouter un titre</h3>
          <div class="row">
            <input type="search" id="addQ" placeholder="Nom du manga, manhwa, webtoon…" aria-label="Chercher un titre" style="flex:1 1 auto">
            <button class="btn ghost" id="addClose">Fermer</button>
          </div>
          <p class="rmeta" style="margin:8px 0 0">Recherche dans le catalogue AniList — plus de 100 000 séries.</p>
        </div>
        <div id="addResults"><p class="note" style="margin:14px 15px">Tape au moins deux lettres pour lancer la recherche.</p></div>
      </div>
    </div>`;
  const input = $("addQ");
  $("addClose").onclick = closeModal;
  $("modalScrim").onclick = e => { if (e.target.id === "modalScrim") closeModal(); };
  let timer = null, seq = 0;
  const run = async () => {
    const term = input.value.trim();
    if (term.length < 2){ $("addResults").innerHTML = `<p class="note" style="margin:14px 15px">Tape au moins deux lettres.</p>`; return; }
    const mine = ++seq;
    $("addResults").innerHTML = `<p class="loading" style="margin:14px 15px">Recherche</p>`;
    try{
      const data = await gql(SEARCH_PAGE_Q, {s: term});
      if (mine !== seq) return;
      const hits = (data.Page.media||[]).map(shapeMedia).filter(Boolean);
      if (!hits.length){ $("addResults").innerHTML = `<p class="note" style="margin:14px 15px">Rien trouvé pour « ${esc(term)} ».</p>`; return; }
      $("addResults").innerHTML = hits.map((h,i)=>{
        const owned = isOwned(h);
        const meta = [h.type, h.annee, h.chapitres?h.chapitres+" ch.":null, h.statut, h.score?h.score+"/100":null].filter(Boolean).join(" · ");
        return `<div class="hit">
          ${h.cover?`<img src="${esc(h.cover)}" alt="" loading="lazy">`:'<span class="ph"></span>'}
          <span style="min-width:0">
            <span class="ht">${esc(h.titre)}</span>${owned?'<span class="owned">déjà chez toi</span>':''}<br>
            <span class="hm">${esc(meta)}${h.auteur?" · "+esc(h.auteur):""}</span>
          </span>
          <span class="act"><button class="btn sm ${owned?'ghost':''}" data-add="${i}" ${owned?'disabled':''}>${owned?'Ajouté':'Ajouter'}</button></span>
        </div>`;
      }).join("");
      [...$("addResults").querySelectorAll("[data-add]")].forEach(b=>{
        b.onclick = () => { if (addFromMedia(hits[+b.dataset.add])){ b.textContent = "Ajouté"; b.disabled = true; b.classList.add("ghost"); } };
      });
    }catch(e){
      if (mine !== seq) return;
      $("addResults").innerHTML = `<p class="err" style="margin:14px 15px">${esc(e.message)}</p>`;
    }
  };
  input.addEventListener("input", ()=>{ clearTimeout(timer); timer = setTimeout(run, 420); });
  if (prefill){ input.value = prefill; run(); }
  input.focus();
}
