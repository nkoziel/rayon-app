/* Mihon / Tachiyomi backup reader: gzip + protobuf, decoded by hand with no dependency and
   no schema, by identifying the field numbers. Runs on the main thread and allocates a BigInt
   per varint (REVIEW.md §2.4) — a Web Worker is the textbook fix if imports get slow. */

import { uid } from '../core/dom.js';
import { norm } from '../core/norm.js';
import { t } from '../core/i18n.js';

/* ============================================================
   Lecture d'une sauvegarde Mihon (.tachibk : gzip + protobuf)
   ============================================================ */
function pbParse(buf, start, end){
  const out = []; let i = start;
  while (i < end){
    let key=0n, shift=0n;
    while(true){ const b=buf[i++]; key |= BigInt(b&0x7f)<<shift; if(!(b&0x80)) break; shift+=7n; }
    const field=Number(key>>3n), wt=Number(key&7n);
    if (wt===0){ let v=0n,s=0n; while(true){ const b=buf[i++]; v|=BigInt(b&0x7f)<<s; if(!(b&0x80)) break; s+=7n; } out.push({f:field,wt,v}); }
    else if (wt===1){ out.push({f:field,wt,v:buf.slice(i,i+8)}); i+=8; }
    else if (wt===2){ let n=0n,s=0n; while(true){ const b=buf[i++]; n|=BigInt(b&0x7f)<<s; if(!(b&0x80)) break; s+=7n; }
      const len=Number(n); out.push({f:field,wt,v:buf.subarray(i,i+len)}); i+=len; }
    else if (wt===5){ const dv=new DataView(buf.buffer, buf.byteOffset+i, 4); out.push({f:field,wt,v:dv.getFloat32(0,true)}); i+=4; }
    else throw new Error("Format inattendu (wire type "+wt+").");
  }
  return out;
}
const dec = new TextDecoder("utf-8");
const group = fields => { const g={}; fields.forEach(x=>{ (g[x.f]=g[x.f]||[]).push(x); }); return g; };
const MSTATUS = {0:"Inconnu",1:"En cours",2:"Terminé",3:"Sous licence",4:"Publication terminée",5:"Annulé",6:"En pause"};
const MMODE = {0:"",1:"Gauche→Droite",2:"Droite→Gauche",3:"Vertical",4:"Webtoon",5:"Vertical continu"};
const isoDay = ms => ms ? new Date(Number(ms)).toISOString().slice(0,10) : "";

/* A Mihon backup is a record of the app, not of the library: it keeps every series you ever
 * opened, including the ones you removed from your favourites, and it keeps one row per SOURCE.
 * Importing it raw gives you series you deliberately dropped, and the same series three times
 * because you migrated it between Asura Scans, Mangakakalot and MangaFire.
 *
 * Measured on a real 232-entry backup: 118 favourites, 114 un-favourited, and 43 titles present
 * more than once. Every single duplicate group had exactly one favourite copy — so honouring the
 * favourite flag fixes the duplicates too, and no separate dedup heuristic has to guess which
 * copy wins.
 *
 * The one thing that flag does NOT get right is progress. When you migrate a series and do not
 * carry the history over, the favourite copy can hold LESS than the copy you abandoned: in that
 * backup Berserk's favourite copy was at 0 read while the abandoned one held 393. Dropping the
 * un-favourited rows outright would have thrown away 625 chapters of real reading. So the rows
 * are folded into the survivor rather than deleted, and progress takes the highest value seen —
 * the same rule mergeLibraries uses: progress never moves backwards.
 */
export function consolidateMihon(entries){
  const groups = new Map();
  for (const e of entries){
    const k = norm(e.t);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(e);
  }

  const out = [];
  let dropped = 0, folded = 0;
  for (const rows of groups.values()){
    const favs = rows.filter(e => e.f);
    if (!favs.length){ dropped += rows.length; continue; }   // removed from the library on purpose

    /* Two favourites under one title are two series the user deliberately keeps apart, so they
       are left alone rather than having each other's progress folded in. */
    if (favs.length > 1){
      dropped += rows.length - favs.length;
      out.push(...favs);
      continue;
    }

    const keep = favs[0];
    for (const e of rows){
      if (e === keep) continue;
      /* Two different AniList ids under one title are two different series - same guard as
         mergeLibraries. Such a row is dropped as un-favourited, not folded in. */
      if (keep.al && e.al && String(keep.al) !== String(e.al)){ dropped++; continue; }
      if ((e.r || 0) > (keep.r || 0)){ keep.r = e.r; keep.d = e.d || keep.d; }
      if ((e.n || 0) > (keep.n || 0)) keep.n = e.n;
      if (!keep.al && e.al) keep.al = e.al;
      folded++;
    }
    if (keep.n < keep.r) keep.n = keep.r;
    out.push(keep);
  }
  return { entries: out, dropped, folded };
}

export function parseBackup(bytes){
  const top = pbParse(bytes,0,bytes.length);
  const sources = {};
  top.filter(x=>x.f===101).forEach(x=>{
    const g = group(pbParse(x.v,0,x.v.length));
    if (g[2]) sources[String(g[2][0].v)] = (g[1] && dec.decode(g[1][0].v)) || t("backup.unknownSource");
  });
  const entries = [];
  top.filter(x=>x.f===1).forEach(x=>{
    const g = group(pbParse(x.v,0,x.v.length));
    const str = f => g[f] ? dec.decode(g[f][0].v) : "";
    const chapters = (g[16]||[]).map(c=>group(pbParse(c.v,0,c.v.length)));
    const read = chapters.filter(c=>c[4] && Number(c[4][0].v)===1).length;
    const hist = (g[104]||[]).map(h=>group(pbParse(h.v,0,h.v.length))).map(h=>h[2]?Number(h[2][0].v):0).filter(Boolean);
    let al = 0;
    (g[18]||[]).forEach(t=>{
      const tg = group(pbParse(t.v,0,t.v.length));
      const m = (tg[4] ? dec.decode(tg[4][0].v) : "").match(/anilist\.co\/manga\/(\d+)/);
      if (m) al = parseInt(m[1],10);
    });
    entries.push({
      id: uid(), t: str(3), a: str(5)||str(4),
      s: sources[String(g[1]?g[1][0].v:"")] || t("backup.unknownSource"),
      st: MSTATUS[g[8]?Number(g[8][0].v):0] || "Inconnu",
      g: (g[7]||[]).map(y=>dec.decode(y.v)).slice(0,6),
      r: read, n: chapters.length,
      d: hist.length ? isoDay(Math.max.apply(null,hist)) : "",
      ad: g[13] ? isoDay(Number(g[13][0].v)) : "",
      m: MMODE[g[14]?Number(g[14][0].v):0] || "",
      al, f: (!g[100] || Number(g[100][0].v)!==0) ? 1 : 0,
      ownedVol: "", origin: "mihon"
    });
  });
  return entries;
}

/* Merge an incoming library into the current one (REVIEW.md §1.5).
   Match on the AniList id when both sides have one, else on the normalised title.
   The governing rule is that progress NEVER moves backwards: importing a friend's list, or an
   older backup, must not undo what you have read. Everything else is filled in only where the
   current entry has nothing. */
