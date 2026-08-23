/* Small DOM and string helpers used everywhere. No app state lives here. */

export const $ = id => document.getElementById(id);

/* Escapes the four characters that matter inside the HTML this app builds by hand.
   Every generated attribute is double-quoted, which is why " is in the set. */
export const esc = s => String(s==null?"":s)
  .replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));

export const stripTags = s => String(s||"")
  .replace(/<br\s*\/?>/gi,"\n").replace(/<[^>]+>/g,"").trim();

export const sleep = ms => new Promise(r => setTimeout(r, ms));

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2,7);

let toastTimer = null;
export function toast(msg){
  const old = document.querySelector(".toast");
  if (old) old.remove();
  const el = document.createElement("div");
  el.className = "toast"; el.textContent = msg;
  document.body.appendChild(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), 3200);
}
