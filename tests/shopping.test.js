import { describe, it, expect, beforeEach } from 'vitest';
import { inShopping, toggleShopping, shoppingRows, defaultPrice, setDefaultPrice } from '../src/ui/shopping.js';
import { LIB, setLib, MBCACHE, state } from '../src/core/state.js';
import { norm } from '../src/core/norm.js';

/* Chapters are digital reading, volumes are the books on a shelf. The shopping list follows
   that split: a series tracked in chapters is not something you buy in a shop. */

const entry = (over = {}) => ({ id: over.t || 'x', t: 'S', r: 0, n: 0, origin: 'mihon', ownedVol: '', ...over });
const withTotal = (t, vol) => { MBCACHE[norm(t)] = { volumes: vol }; };

beforeEach(() => {
  for (const k of Object.keys(MBCACHE)) delete MBCACHE[k];
  setLib({ label: 't', entries: [] });
  state.unit = 'ch';
});

describe('inShopping — the include/exclude rule', () => {
  it('excludes a series tracked in chapters', () => {
    expect(inShopping(entry({ unit: 'ch' }))).toBe(false);
  });

  it('includes a series tracked in volumes', () => {
    expect(inShopping(entry({ unit: 'vol' }))).toBe(true);
  });

  it('follows the global unit when the series has none', () => {
    state.unit = 'vol';
    expect(inShopping(entry())).toBe(true);
  });

  it('lets an explicit choice override the unit, both ways', () => {
    expect(inShopping(entry({ unit: 'ch', shop: true }))).toBe(true);
    expect(inShopping(entry({ unit: 'vol', shop: false }))).toBe(false);
  });

  it('toggles from whatever the current effective value is', () => {
    const d = entry({ unit: 'vol' });          // implicitly included
    toggleShopping(d);
    expect(d.shop).toBe(false);
    toggleShopping(d);
    expect(d.shop).toBe(true);
  });
});

describe('shoppingRows — the two lists are different purchases', () => {
  it('separates continuing a collection from starting one', () => {
    withTotal('Started', 10);
    withTotal('Untouched', 5);
    setLib({ label: 't', entries: [
      entry({ id: 'a', t: 'Started',   unit: 'vol', ownedVol: '1-3' }),
      entry({ id: 'b', t: 'Untouched', unit: 'vol', ownedVol: '' }),
    ]});
    const { cont, start } = shoppingRows();
    expect(cont.map(r => r.d.t)).toEqual(['Started']);
    expect(start.map(r => r.d.t)).toEqual(['Untouched']);
  });

  it('sorts "continue" by how close to complete, so a trip finishes something', () => {
    withTotal('Nearly', 10); withTotal('Barely', 10);
    setLib({ label: 't', entries: [
      entry({ id: 'a', t: 'Barely', unit: 'vol', ownedVol: '1' }),
      entry({ id: 'b', t: 'Nearly', unit: 'vol', ownedVol: '1-9' }),
    ]});
    expect(shoppingRows().cont.map(r => r.d.t)).toEqual(['Nearly', 'Barely']);
  });

  it('keeps a complete collection out of both lists', () => {
    withTotal('Done', 5);
    setLib({ label: 't', entries: [entry({ id: 'a', t: 'Done', unit: 'vol', ownedVol: '1-5' })] });
    const { cont, start, done } = shoppingRows();
    expect(cont).toHaveLength(0);
    expect(start).toHaveLength(0);
    expect(done).toHaveLength(1);
  });

  it('ignores series excluded from shopping', () => {
    withTotal('Digital', 10);
    setLib({ label: 't', entries: [entry({ id: 'a', t: 'Digital', unit: 'vol', shop: false, ownedVol: '1' })] });
    expect(shoppingRows().rows).toHaveLength(0);
  });

  it('lists a series with no known total, without inventing missing volumes', () => {
    setLib({ label: 't', entries: [entry({ id: 'a', t: 'Unknown', unit: 'vol', ownedVol: '1-3' })] });
    const { rows, cont } = shoppingRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].missing).toEqual([]);
    expect(cont).toHaveLength(0);      // nothing known to be missing, so nothing to buy
  });
});

describe('cost — an honest estimate, never a fake precision', () => {
  it('multiplies missing volumes by the configured rate', () => {
    setDefaultPrice(8);
    withTotal('S', 10);
    setLib({ label: 't', entries: [entry({ id: 'a', t: 'S', unit: 'vol', ownedVol: '1-8' })] });
    expect(shoppingRows().cont[0].cost).toBe(16);       // 2 missing x 8
  });

  it('lets a series override the rate, for a boxset or a deluxe edition', () => {
    setDefaultPrice(8);
    withTotal('S', 10);
    setLib({ label: 't', entries: [entry({ id: 'a', t: 'S', unit: 'vol', ownedVol: '1-8', volPrice: 20 })] });
    expect(shoppingRows().cont[0].cost).toBe(40);
  });

  it('falls back to a sane default rather than zero', () => {
    setDefaultPrice(0);            // refused
    expect(defaultPrice()).toBe(7.5);
  });
});

describe('gaps — the hole in the middle of a shelf', () => {
  it('reports a missing volume below one you already own', () => {
    withTotal('S', 10);
    setLib({ label: 't', entries: [entry({ id: 'a', t: 'S', unit: 'vol', ownedVol: '1-3,5-7' })] });
    expect(shoppingRows().cont[0].gaps).toEqual([4]);
  });

  it('does not count volumes above your highest as gaps', () => {
    withTotal('S', 10);
    setLib({ label: 't', entries: [entry({ id: 'a', t: 'S', unit: 'vol', ownedVol: '1-3' })] });
    expect(shoppingRows().cont[0].gaps).toEqual([]);
  });
});
