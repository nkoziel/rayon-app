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

const FILE = path.join(__dirname, '..', 'index.html');
const html = fs.readFileSync(FILE, 'utf8');

let failures = 0;
const fail = (msg) => { failures++; console.log('  FAIL ' + msg); };
const section = (name) => console.log('\n=== ' + name + ' ===');

/* ---------- 1. syntax ---------- */
section('Syntaxe du script inline');
const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
if (!blocks.length) fail('aucun bloc <script> trouve');
blocks.forEach((b, i) => {
  try {
    new vm.Script(b[1], { filename: `index.html#${i}` });
    console.log(`  OK   script #${i} (${b[1].split('\n').length} lignes)`);
  } catch (e) {
    fail(`script #${i} : ${e.message}`);
  }
});

/* ---------- helpers ---------- */
/* Pull one top-level `const NAME = ...;` statement out of index.html by line, and evaluate it.
   Line-based rather than one big regex: these declarations span several lines and end with a
   trailing `//` comment after the semicolon, which a `;\n` pattern silently misses. */
const srcLines = html.split('\n');
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

/* ---------- 2. chapNumOf (REVIEW.md §1.6) ---------- */
const chapNumOf = extract('chapNumOf');
table('chapNumOf — un nombre dans le nom ne doit pas propulser la progression', chapNumOf, [
  ['Chapter 145.cbz',              145],
  ['one-piece-1102.cbz',          1102],
  ['Solo Leveling 179 (2021).cbz', 179],
  ['[2024] Vol.3 - 12.cbz',         12],   // etait 2024
  ['Asura Scans 2024 - 05.cbz',      5],   // etait 2024
  ['Volume 05.cbz',               null],   // un tome n'est pas un chapitre
  ['Tome 4.cbz',                  null],
  ['T01.cbz',                     null],
  ['1984.cbz',                    null],   // annee seule : mieux vaut null qu'un faux numero
  ['Ch. 115',                      115],
  ['Chapitre 7.5.cbz',             7.5],
  ['c012.cbz',                      12],
  ['Ch.0001.cbz',                    1],
  ['[Asura] Chapter 88 [1080p].cbz', 88],
  ['Vol.2 Ch.15.cbz',               15],
  ['Vol 12 - Chapter 3.cbz',         3],
  ['Naruto 700.cbz',               700],
  ['Berserk 364.cbz',              364],
  ['2019-05-03 release 42.cbz',     42],
  ['03.05.2019 - 88.cbz',           88],
  ['no numbers here.cbz',         null],
]);

/* ---------- 3. norm (REVIEW.md §1.1) ---------- */
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

console.log(failures ? `\n${failures} echec(s)\n` : '\nTout passe.\n');
process.exit(failures ? 1 : 0);
