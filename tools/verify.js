#!/usr/bin/env node
/*
 * Build-output checks. Zero dependencies, runs without a browser.
 *
 * The pure-logic case tables that used to live here are now real tests under `tests/`
 * (`npm test`) — the module split made the code importable, so they no longer have to be
 * extracted from source by hand. What is left is the thing Vitest cannot see: whether the
 * file we actually publish is correct.
 *
 *   node tools/verify.js       parses src/, checks the published bundle
 *   node tools/check-refs.js   free variables and import cycles
 *   npm test                   the behaviour suites
 *   npm run verify             all three
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src');

function jsFiles(dir){
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? jsFiles(p) : (e.name.endsWith('.js') ? [p] : []);
  });
}
const files = jsFiles(SRC).sort();
const sources = new Map(files.map(f => [path.relative(SRC, f).replace(/\\/g, '/'), fs.readFileSync(f, 'utf8')]));

let failures = 0;
const fail = (msg) => { failures++; console.log('  FAIL ' + msg); };
const section = (name) => console.log('\n=== ' + name + ' ===');

/* ---------- 1. every module parses ---------- */
section('Syntaxe des modules de src/');
for (const [name, code] of sources) {
  try {
    /* vm.Script parses scripts, not modules, so strip the module syntax first.
       `import\s` — the whitespace is load-bearing. Without it this matches `import:` used as
       an object key (SRCNOTE has one) and eats everything up to the next `from '...'`,
       silently truncating the file and reporting a bogus syntax error. */
    const asScript = code
      .replace(/^\s*import\s[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, '')
      .replace(/^\s*import\s+['"][^'"]+['"];?\s*$/gm, '')
      .replace(/^export\s+/gm, '');
    new vm.Script(asScript, { filename: name });
    console.log(`  OK   ${name.padEnd(20)} ${code.split('\n').length} lignes`);
  } catch (e) {
    fail(`${name} : ${e.message}`);
  }
}

/* ---------- 2. the published file must stay one self-contained file ---------- */
section('index.html publie');
const builtPath = path.join(__dirname, '..', 'index.html');
if (!fs.existsSync(builtPath)) fail('index.html absent — lancer `npm run build`');
else {
  const built = fs.readFileSync(builtPath, 'utf8');

  /* A page that references a local file it does not carry half-loads for everyone. Icons and
     the manifest are fetched separately by the browser and are meant to be external. */
  const externals = [...built.matchAll(/<(?:script[^>]*\ssrc|link[^>]*\shref)=["']([^"']+)["']/g)]
    .map(m => m[1])
    .filter(u => !/^(https?:|data:|#)/.test(u) && !/^\.?\/?(icons\/|manifest\.webmanifest)/.test(u));
  if (externals.length) externals.forEach(u => fail('reference externe : ' + u));
  else console.log(`  OK   autonome (${(Buffer.byteLength(built, 'utf8') / 1024).toFixed(1)} Ko)`);

  /* The root file is a build artifact that is committed, so it can silently fall behind the
     source it was built from. Editing it directly is the mistake this catches. */
  const marker = 'function mergeLibraries';
  const inSource = [...sources.values()].some(s => s.includes(marker));
  if (inSource && !built.includes(marker))
    fail('index.html ne contient pas le code de src/ — relancer `npm run build`');
  else console.log('  OK   a jour avec src/');
}

console.log(failures ? `\n${failures} echec(s)\n` : '\nTout passe.\n');
process.exit(failures ? 1 : 0);
