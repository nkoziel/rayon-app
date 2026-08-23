#!/usr/bin/env node
/*
 * Verification harness. Zero dependencies, no test runner yet (REVIEW.md §3.1):
 *
 *   1. parses every module under src/ so syntax errors surface without opening a browser
 *   2. checks the published root index.html is self-contained and not stale
 *   3. extracts pure functions BY SOURCE and runs case tables against them
 *
 * Point 3 matters: it exercises the code that actually ships, not a copy that can drift.
 *
 *   node tools/verify.js
 *
 * The extraction is a pragmatic stand-in for real imports, and it is deliberately dumb —
 * it evaluates a declaration as a script, so `export` prefixes are stripped. Once the module
 * split finishes, these tables move to Vitest and import properly, unchanged.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

/* Source of truth is src/. The root index.html is a build artifact — testing that would test
   the bundler, not the code. */
const SRC = path.join(__dirname, '..', 'src');

function jsFiles(dir){
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? jsFiles(p) : (e.name.endsWith('.js') ? [p] : []);
  });
}
const files = jsFiles(SRC).sort();
const sources = new Map(files.map(f => [path.relative(SRC, f).replace(/\\/g, '/'), fs.readFileSync(f, 'utf8')]));

/* All module sources concatenated, for finding a declaration wherever it now lives. */
const source = [...sources.values()].join('\n');

let failures = 0;
const fail = (msg) => { failures++; console.log('  FAIL ' + msg); };
const section = (name) => console.log('\n=== ' + name + ' ===');

/* ---------- 1. syntax ---------- */
section('Syntaxe des modules de src/');
for (const [name, code] of sources) {
  try {
    /* vm.Script parses scripts, not modules, so strip the module syntax first. Enough to
       catch the class of error this is here for; it is not a module resolver. */
    const asScript = code
      .replace(/^\s*import[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, '')
      .replace(/^\s*import\s+['"][^'"]+['"];?\s*$/gm, '')
      .replace(/^export\s+/gm, '');
    new vm.Script(asScript, { filename: name });
    console.log(`  OK   ${name.padEnd(18)} ${code.split('\n').length} lignes`);
  } catch (e) {
    fail(`${name} : ${e.message}`);
  }
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
const declares = (line, name) =>
  line.startsWith(`const ${name} = `) || line.startsWith(`export const ${name} = `);

function extract(name) {
  const start = srcLines.findIndex(l => declares(l, name));
  if (start === -1) { fail(`declaration de ${name} introuvable dans src/`); return null; }
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
  const normStart = srcLines.findIndex(l => declares(l, 'norm'));
  /* drop the `export ` prefix: this is evaluated as a script, not a module */
  const normSrc = srcLines.slice(normStart, normStart + 4).join('\n').replace(/^export\s+/, '');
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
  const start = srcLines.findIndex(l => new RegExp(`^(export )?(async )?function ${name}\\(`).test(l));
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
  const i = srcLines.findIndex(l => declares(l, name));
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
