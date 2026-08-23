#!/usr/bin/env node
/*
 * Verification harness for the single-file app.
 *
 * `index.html` is one ~1,900-line file with inline JS, so nothing can be imported and there is
 * no test runner yet (REVIEW.md §3.1). This does what is possible in the meantime, with zero
 * dependencies:
 *
 *   1. parses the inline <script> so syntax errors surface without opening a browser
 *   2. extracts the pure functions BY SOURCE from index.html and runs case tables against them
 *
 * Point 2 matters: it tests the code that actually ships, not a copy that can drift.
 *
 *   node tools/verify.js
 *
 * When the module split lands (roadmap phase 4), these tables move to Vitest unchanged.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

/* Source of truth is src/main.js. The root index.html is a build artifact — testing that
   would test the bundler, not the code. */
const FILE = path.join(__dirname, '..', 'src', 'main.js');
const source = fs.readFileSync(FILE, 'utf8');

let failures = 0;
const fail = (msg) => { failures++; console.log('  FAIL ' + msg); };
const section = (name) => console.log('\n=== ' + name + ' ===');

/* ---------- 1. syntax ---------- */
section('Syntaxe de src/main.js');
try {
  /* vm.Script cannot parse import/export. Once the module split lands, strip those lines
     before parsing (or move to a real parser) — for now main.js has none. */
  new vm.Script(source, { filename: 'src/main.js' });
  console.log(`  OK   ${source.split('\n').length} lignes`);
} catch (e) {
  fail(`src/main.js : ${e.message}`);
}

/* ---------- 1b. the published file must stay self-contained ---------- */
section('index.html publie — un seul fichier, aucune dependance locale');
const builtPath = path.join(__dirname, '..', 'index.html');
if (!fs.existsSync(builtPath)) fail('index.html absent — lancer `npm run build`');
else {
  const built = fs.readFileSync(builtPath, 'utf8');
  const externals = [...built.matchAll(/<(?:script[^>]*\ssrc|link[^>]*\shref)=["']([^"']+)["']/g)]
    .map(m => m[1])
    .filter(u => !/^(https?:|data:|#)/.test(u) && !/^\.?\/?(icons\/|manifest\.webmanifest)/.test(u));
  if (externals.length) externals.forEach(u => fail('reference externe : ' + u));
  else console.log(`  OK   autonome (${(Buffer.byteLength(built, 'utf8') / 1024).toFixed(1)} Ko)`);

  /* the build must not lag behind the source it was made from */
  const marker = 'function mergeLibraries';
  if (source.includes(marker) && !built.includes(marker))
    fail('index.html ne contient pas le code de src/main.js — build a relancer');
}

/* ---------- helpers ---------- */
/* Pull one top-level `const NAME = ...;` statement out of index.html by line, and evaluate it.
   Line-based rather than one big regex: these declarations span several lines and end with a
   trailing `//` comment after the semicolon, which a `;\n` pattern silently misses. */
const srcLines = source.split('\n');
function extract(name) {
  const start = srcLines.findIndex(l => l.startsWith(`const ${name} = `));
  if (start === -1) { fail(`declaration de ${name} introuvable dans index.html`); return null; }
  /* Counting braces does NOT work here: a character class like [\[\(\{][^\]\)\}]*[\]\)\}]
     holds one { and two }, so the depth goes negative and the scan overruns. Match the file's
     actual shape instead — a block body closes on a line that is exactly `};`, an arrow
     expression ends on the first line terminated by `;`. */
  const blockBody = srcLines[start].includes('{');
  const done = blockBody
    ? (l) => l.trim() === '};'
    : (l) => /;\s*(\/\/.*)?$/.test(l);
  let end = start;
  const LIMIT = 200;
  while (end < srcLines.length && end - start < LIMIT && !done(srcLines[end])) end++;
  if (end >= srcLines.length || end - start >= LIMIT) {
    fail(`fin de la declaration de ${name} introuvable`); return null;
  }

  const block = srcLines.slice(start, end + 1).join('\n');
  const body = block.slice(block.indexOf('=') + 1, block.lastIndexOf(';'));
  try {
    return vm.runInNewContext('(' + body + ')');
  } catch (e) {
    fail(`${name} ne s'evalue pas : ${e.message}`);
    return null;
  }
}

function table(name, fn, cases) {
  section(name);
  if (!fn) { fail(name + ' indisponible'); return; }
  let pass = 0;
  for (const [input, expected] of cases) {
    const got = fn(input);
    if (got === expected) { pass++; }
    else fail(`${JSON.stringify(input)} -> ${JSON.stringify(got)}, attendu ${JSON.stringify(expected)}`);
  }
  console.log(`  ${pass}/${cases.length} cas passent`);
}

/* chapNumOf (REVIEW.md §1.6) is gone: the embedded reader was removed, so nothing parses
   chapter numbers out of filenames any more. The safest fix for that class of bug turned out
   to be deleting the feature. Its 21-case table is in git history if it ever comes back. */

/* ---------- 2. norm (REVIEW.md §1.1) ---------- */
const norm = extract('norm');
table('norm — les titres non latins ne doivent pas s\'ecraser', norm, [
  ['One Piece',        'onepiece'],
  ['Pokémon',           'pokemon'],
  ['Ké Nöël & Co',     'kenoelco'],
  ['進撃の巨人',        '進撃の巨人'],
  ['ワンピース',        'ワンピース'],   // NFC : ne doit PAS devenir ワンヒース
  ['斗罗大陆',          '斗罗大陆'],
  ['나 혼자만 레벨업', '나혼자만레벨업'],
]);

if (norm) {
  section('norm — collisions');
  const distinct = ['進撃の巨人', 'ワンピース', '斗罗大陆', '나 혼자만 레벨업', 'One Piece'];
  const keys = new Set(distinct.map(norm));
  if (keys.size !== distinct.length) fail(`${distinct.length} titres -> seulement ${keys.size} cles`);
  else console.log(`  OK   ${distinct.length} titres distincts -> ${keys.size} cles distinctes`);
  if (distinct.some(t => norm(t) === '')) fail('un titre produit une cle vide');
  else console.log('  OK   aucune cle vide');
  if (norm('パパ') === norm('ハハ')) fail('パパ et ハハ entrent en collision (NFC manquant ?)');
  else console.log('  OK   パパ et ハハ restent distincts');
}

/* ---------- 4. mergeLibraries (REVIEW.md §1.5) ---------- */
section('mergeLibraries — importer ne doit jamais faire reculer une progression');
{
  const src = extractFunction('mergeLibraries');
  const normStart = srcLines.findIndex(l => l.startsWith('const norm = '));
  const normSrc = srcLines.slice(normStart, normStart + 4).join('\n');
  if (!src) fail('mergeLibraries indisponible');
  else {
    const sb = { console };
    vm.createContext(sb);
    vm.runInContext(normSrc + '\n' + src, sb);
    const merge = (a, b) => vm.runInContext('mergeLibraries', sb)(a, b);

    const at = (list, t) => list.find(e => e.t === t);

    // progress must never regress, whichever side is behind
    let r = merge(
      [{ t: 'One Piece', al: 30013, r: 900, rv: 0 }],
      [{ t: 'One Piece', al: 30013, r: 500, rv: 0 }]);
    if (at(r.entries, 'One Piece').r !== 900) fail(`progression reculee : ${at(r.entries,'One Piece').r} au lieu de 900`);

    r = merge(
      [{ t: 'One Piece', al: 30013, r: 500 }],
      [{ t: 'One Piece', al: 30013, r: 900 }]);
    if (at(r.entries, 'One Piece').r !== 900) fail('progression plus avancee non adoptee');
    if (r.updated !== 1) fail(`updated=${r.updated}, attendu 1`);

    // same series, one side lacking the AniList id -> matched on title, not duplicated
    r = merge([{ t: 'Berserk', al: 0, r: 10 }], [{ t: 'Berserk', al: 0, r: 20 }]);
    if (r.entries.length !== 1) fail(`doublon sur titre identique : ${r.entries.length} entrees`);

    // CJK titles must not collapse together (depends on the §1.1 fix)
    r = merge([], [{ t: '進撃の巨人', al: 0, r: 1 }, { t: 'ワンピース', al: 0, r: 2 }]);
    if (r.entries.length !== 2) fail(`titres CJK fusionnes a tort : ${r.entries.length} entree(s)`);

    // a genuinely new series is added
    r = merge([{ t: 'A', al: 1, r: 5 }], [{ t: 'B', al: 2, r: 3 }]);
    if (r.entries.length !== 2 || r.added !== 1) fail(`ajout : ${r.entries.length} entrees, added=${r.added}`);

    // an absent AniList id is filled in from the incoming side
    r = merge([{ t: 'C', al: 0, r: 1 }], [{ t: 'C', al: 99, r: 1 }]);
    if (at(r.entries, 'C').al !== 99) fail('al non complete depuis l import');

    // a manual total is adopted only when we have none
    r = merge([{ t: 'D', al: 4, r: 1, manCh: 50 }], [{ t: 'D', al: 4, r: 1, manCh: 10 }]);
    if (at(r.entries, 'D').manCh !== 50) fail('total manuel existant ecrase par l import');

    // two different series that happen to share a title must NOT be merged
    r = merge([{ t: 'Bleach', al: 11, r: 5 }], [{ t: 'Bleach', al: 22, r: 7 }]);
    if (r.entries.length !== 2) fail('deux ids AniList differents fusionnes a tort');

    if (failures === 0) console.log('  OK   8 regles de fusion respectees');
  }
}

/* ---------- 5. migrateCaches (REVIEW.md §1.2) ----------
   Runs the real migration against fake storage. This cannot prove IndexedDB behaves, but it
   does prove the ordering invariant that matters: a localStorage key is only dropped once its
   value is safely stored elsewhere. Getting that wrong destroys libraries. */
function extractFunction(name) {
  const start = srcLines.findIndex(l => new RegExp(`^(async )?function ${name}\\(`).test(l));
  if (start === -1) { fail(`fonction ${name} introuvable`); return null; }
  let end = start;
  while (end < srcLines.length && srcLines[end] !== '}') end++;
  if (end >= srcLines.length) { fail(`fin de ${name} introuvable`); return null; }
  return srcLines.slice(start, end + 1).join('\n');
}

function makeSandbox(kvShouldFail) {
  const ls = new Map();
  const kvStore = new Map();
  const localStorage = {
    get length() { return ls.size; },
    key: (i) => [...ls.keys()][i],
    getItem: (k) => (ls.has(k) ? ls.get(k) : null),
    setItem: (k, v) => ls.set(k, String(v)),
    removeItem: (k) => ls.delete(k),
  };
  const store = {
    get(k) { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; },
    set(k, v) { localStorage.setItem(k, JSON.stringify(v)); return true; },
    del(k) { localStorage.removeItem(k); },
  };
  const kvSet = async (k, v) => { if (kvShouldFail) return false; kvStore.set(k, v); return true; };
  const kvDel = async (k) => { kvStore.delete(k); };
  return { ls, kvStore, localStorage, store, kvSet, kvDel, console };
}

const migrateSrc = extractFunction('migrateCaches');
const constLine = (name) => {
  const i = srcLines.findIndex(l => l.startsWith(`const ${name} = `));
  return i === -1 ? null : srcLines[i];
};
const cacheKeysSrc = [constLine('CACHE_KEYS'), constLine('DEAD_KEYS')].filter(Boolean).join('\n');

section('migrateCaches — les caches quittent localStorage sans perte');
if (!migrateSrc || !cacheKeysSrc) fail('migrateCaches ou CACHE_KEYS indisponible');
else {
  /* nominal case: everything moves across, preferences stay put */
  const sb = makeSandbox(false);
  vm.createContext(sb);
  sb.localStorage.setItem('meta:v2', JSON.stringify({ a: 1 }));
  sb.localStorage.setItem('md:v1', JSON.stringify({ b: 2 }));
  sb.localStorage.setItem('reco:v3:onepiece', JSON.stringify({ items: [] }));
  sb.localStorage.setItem('lib:v1', JSON.stringify({ entries: [] }));   // must NOT move
  sb.localStorage.setItem('unit:v1', JSON.stringify('vol'));            // must NOT move
  vm.runInContext(cacheKeysSrc + '\n' + migrateSrc + '\nmigrateCaches();', sb);

  setTimeout(() => {
    const moved = ['meta:v2', 'md:v1', 'reco:v3:onepiece'];
    moved.forEach(k => {
      if (sb.ls.has(k)) fail(`${k} est reste dans localStorage`);
      if (!sb.kvStore.has(k)) fail(`${k} n'a pas ete ecrit dans le cache`);
    });
    if (!sb.ls.has('lib:v1')) fail('lib:v1 a ete deplace alors qu il doit rester');
    if (!sb.ls.has('unit:v1')) fail('unit:v1 (preference) a ete deplace');
    if (failures === 0) console.log('  OK   caches deplaces, bibliotheque et preferences intactes');

    /* failure case: if the new store refuses the write, the original must survive */
    const sb2 = makeSandbox(true);
    vm.createContext(sb2);
    sb2.localStorage.setItem('meta:v2', JSON.stringify({ a: 1 }));
    vm.runInContext(cacheKeysSrc + '\n' + migrateSrc + '\nmigrateCaches();', sb2);
    setTimeout(() => {
      if (!sb2.ls.has('meta:v2'))
        fail('meta:v2 supprime alors que l ecriture du cache a echoue — perte de donnees');
      else console.log('  OK   ecriture refusee : l original est conserve');

      console.log(failures ? `\n${failures} echec(s)\n` : '\nTout passe.\n');
      process.exit(failures ? 1 : 0);
    }, 30);
  }, 30);
}
