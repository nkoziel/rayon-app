#!/usr/bin/env node
/*
 * Catch free variables left behind by the module split.
 *
 * Rollup resolves *imports*, but a name that used to be a global in the single-file app and is
 * now neither declared nor imported becomes a free variable — it bundles fine and throws a
 * ReferenceError at runtime, on whatever code path happens to touch it. That is exactly the
 * failure the split is prone to, so it gets its own check.
 *
 * Deliberately a heuristic, not a parser: it only looks for identifiers that the app itself
 * defines somewhere, so unknown browser globals are never reported.
 *
 * KNOWN LIMIT, learned the hard way: a name declared NOWHERE is invisible here. A call to a
 * parameter that was never added to the signature slipped straight through, because the
 * checker had nothing to match it against. This catches names that moved, not names that
 * never existed — Rollup and the browser catch those.
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src');

function jsFiles(dir){
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? jsFiles(p) : (e.name.endsWith('.js') ? [p] : []);
  });
}

const files = jsFiles(SRC);
const rel = f => path.relative(SRC, f).replace(/\\/g, '/');

/* every name the app declares, anywhere */
const declaredIn = new Map();
const paramsIn = new Map();
for (const f of files) {
  const text = fs.readFileSync(f, 'utf8');
  const names = new Set();
  for (const re of [
    /^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm,
    /^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)/gm,
  ]) {
    let m; while ((m = re.exec(text))) names.add(m[1]);
  }
  declaredIn.set(rel(f), names);
  /* Parameters and other local bindings are not exports, but they ARE in scope — counting
     them keeps the report free of noise. A checker nobody trusts gets ignored. */
  const locals = new Set();
  for (const re of [
    /(?:function\s*[A-Za-z_$\w]*\s*)\(([^)]*)\)/g,   // function decls and expressions
    /\(([^()]*)\)\s*=>/g,                             // arrow params
    /(?:^|[^\w$])([A-Za-z_$][\w$]*)\s*=>/g,           // single-param arrows
    /catch\s*\(\s*([A-Za-z_$][\w$]*)/g,
    /for\s*\(\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g,
    /(?:const|let|var)\s*\{([^}]*)\}/g,               // destructuring
    /(?:const|let|var)\s*\[([^\]]*)\]/g,
    /(?:^|[^\w$])(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g,   // INDENTED block-scoped locals
  ]) {
    let m;
    while ((m = re.exec(text)))
      String(m[1]).split(',').forEach(p => {
        const n = p.trim().split(/[:=\s]/)[0].replace(/^\.\.\./, '');
        if (/^[A-Za-z_$][\w$]*$/.test(n)) locals.add(n);
      });
  }
  paramsIn.set(rel(f), locals);
}
const appNames = new Set([...declaredIn.values()].flatMap(s => [...s]));

let problems = 0;
for (const f of files) {
  const name = rel(f);
  const text = fs.readFileSync(f, 'utf8');

  /* what this file can legitimately see: its own declarations + everything it imports */
  const local = new Set([...declaredIn.get(name), ...(paramsIn.get(name) || [])]);
  for (const m of text.matchAll(/import\s*\{([^}]+)\}\s*from/g)) {
    m[1].split(',').forEach(part => {
      const bits = part.trim().split(/\s+as\s+/);
      const bound = (bits[1] || bits[0] || '').trim();
      if (bound) local.add(bound);
    });
  }
  /* strip comments and strings so their contents are not mistaken for code */
  const code = text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``')
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''");

  const used = new Set();
  for (const m of code.matchAll(/(^|[^.\w$])([A-Za-z_$][\w$]*)\s*(?=[(.[]|\s*[=!<>+\-*/,);\]}])/g)) used.add(m[2]);

  /* Regex literals are not stripped above (telling `/` division from a regex needs a real
     parser), so the `$` ending an anchored pattern like /^(\d+)$/ looks like a use of the
     `$` helper. It is only ever called as `$("id")`, so require the parenthesis. */
  const free = [...used].filter(n => appNames.has(n) && !local.has(n))
    .filter(n => n !== '$' || new RegExp('\\$\\s*\\(').test(code));
  if (free.length) {
    problems += free.length;
    console.log(`\n${name}`);
    free.sort().forEach(n => {
      const where = [...declaredIn].filter(([, s]) => s.has(n)).map(([f]) => f).join(', ');
      console.log(`  ${n}  — declare dans ${where || '?'}`);
    });
  }
}

console.log(problems ? `\n${problems} reference(s) libre(s)\n` : '\nAucune reference libre.');

/* ---------- import cycles ----------
   The whole point of the split was an acyclic dependency graph:
     main -> ui/library -> ui/sheet -> ui/tracker -> data/* -> core/*
   ES modules tolerate cycles for hoisted function declarations, which is exactly what makes
   them dangerous: one works, the next throws on a `const` caught in its temporal dead zone,
   and only on whichever path happens to run first. ui/refresh.js exists to keep this clean —
   if a cycle appears, reach for late binding rather than accepting it. */
const graph = new Map();
for (const f of files) {
  const key = rel(f);
  const dir = path.posix.dirname(key);
  const deps = [...fs.readFileSync(f, 'utf8').matchAll(/from\s+['"](\.[^'"]+)['"]/g)]
    .map(m => path.posix.normalize(path.posix.join(dir, m[1])));
  graph.set(key, deps);
}

let cycles = 0;
const state = new Map();          // 0 = visiting, 1 = done
const stack = [];
function walk(node){
  if (state.get(node) === 0){
    console.log('  CYCLE  ' + stack.slice(stack.indexOf(node)).join(' -> ') + ' -> ' + node);
    cycles++;
    return;
  }
  if (state.get(node) === 1) return;
  state.set(node, 0);
  stack.push(node);
  for (const d of (graph.get(node) || [])) walk(d);
  stack.pop();
  state.set(node, 1);
}
for (const key of graph.keys()) walk(key);

console.log(cycles ? `\n${cycles} cycle(s) d'import\n` : "Aucun cycle d'import.\n");
process.exit(problems || cycles ? 1 : 0);
