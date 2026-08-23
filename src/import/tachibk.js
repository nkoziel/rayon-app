/* Mihon / Tachiyomi backup reader: gzip + protobuf, decoded by hand with no dependency and
   no schema, by identifying the field numbers. Runs on the main thread and allocates a BigInt
   per varint (REVIEW.md §2.4) — a Web Worker is the textbook fix if imports get slow. */

import { uid } from '../core/dom.js';

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

export function parseBackup(bytes){
  const top = pbParse(bytes,0,bytes.length);
  const sources = {};
  top.filter(x=>x.f===101).forEach(x=>{
    const g = group(pbParse(x.v,0,x.v.length));
    if (g[2]) sources[String(g[2][0].v)] = (g[1] && dec.decode(g[1][0].v)) || "Source inconnue";
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
      s: sources[String(g[1]?g[1][0].v:"")] || "Source inconnue",
      st: MSTATUS[g[8]?Number(g[8][0].v):0] || "Inconnu",
      g: (g[7]||[]).map(y=>dec.decode(y.v)).slice(0,6),
      r: read, n: chapters.length,
      d: hist.length ? isoDay(Math.max.apply(null,hist)) : "",
      ad: g[13] ? isoDay(Number(g[13][0].v)) : "",
      m: MMODE[g[14]?Number(g[14][0].v):0] || "",
      al, f: (!g[100] || Number(g[100][0].v)!==0) ? 1 : 0,
      rv: 0, origin: "mihon"
    });
  });
  return entries;
}

/* Merge an incoming library into the current one (REVIEW.md §1.5).
   Match on the AniList id when both sides have one, else on the normalised title.
   The governing rule is that progress NEVER moves backwards: importing a friend's list, or an
   older backup, must not undo what you have read. Everything else is filled in only where the
   current entry has nothing. */
