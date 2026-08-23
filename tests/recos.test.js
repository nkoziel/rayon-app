import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MBCACHE } from '../src/core/state.js';
import { norm } from '../src/core/norm.js';

/* MangaBaka gives two complementary signals and says WHY. A title that both signals agree on
   is the strongest recommendation available, so the merge has to notice that rather than
   listing it twice. */

vi.mock('../src/data/mangabaka.js', () => ({
  recommendations: vi.fn(),
}));
vi.mock('../src/data/anilist.js', () => ({
  loadRecos: vi.fn(async () => ({ source: 'x', matched: 'y', items: [{ id: 1, titre: 'Fallback', votes: 3, genres: [] }] })),
}));

const { recommendations } = await import('../src/data/mangabaka.js');
const { loadRecos } = await import('../src/data/anilist.js');
const { recosFor } = await import('../src/data/recos.js');

const entry = { t: 'Test Serie' };
const rec = (mb, titre, why) => ({ mb, titre, why: { kind: 'similar', score: 0, tags: [], sharedUsers: 0, tagsTotal: 0, ...why } });

beforeEach(() => {
  for (const k of Object.keys(MBCACHE)) delete MBCACHE[k];
  vi.clearAllMocks();
});

describe('recosFor — merging the two signals', () => {
  beforeEach(() => {
    MBCACHE[norm(entry.t)] = { mb: 377, titre: 'ONE PIECE', url: 'u' };
  });

  it('keeps a title that both signals agree on ONCE, and first', () => {
    recommendations.mockImplementation(async (id, kind) =>
      kind === 'similar'
        ? [rec(1, 'Toriko', { score: 0.4, tags: ['Shounen'] }), rec(2, 'Gintama', { score: 0.9 })]
        : [rec(1, 'Toriko', { sharedUsers: 140 })]);

    return recosFor(entry, true).then(p => {
      expect(p.provider).toBe('mangabaka');
      expect(p.items).toHaveLength(2);
      const toriko = p.items.find(x => x.mb === 1);
      expect(toriko.why.both).toBe(true);
      expect(toriko.why.sharedUsers).toBe(140);
      expect(toriko.why.tags).toEqual(['Shounen']);
      /* agreement outranks a higher content score on its own */
      expect(p.items[0].mb).toBe(1);
    });
  });

  it('sorts the rest by content score', async () => {
    recommendations.mockImplementation(async (id, kind) =>
      kind === 'similar' ? [rec(1, 'A', { score: 0.2 }), rec(2, 'B', { score: 0.8 })] : []);
    const p = await recosFor(entry, true);
    expect(p.items.map(x => x.mb)).toEqual([2, 1]);
  });

  it('survives one signal failing', async () => {
    recommendations.mockImplementation(async (id, kind) => {
      if (kind === 'readers') throw new Error('boom');
      return [rec(1, 'A', { score: 0.5 })];
    });
    const p = await recosFor(entry, true);
    expect(p.items).toHaveLength(1);
  });
});

describe('recosFor — falling back', () => {
  it('uses AniList when the series is not in the MangaBaka cache', async () => {
    const p = await recosFor(entry, true);
    expect(p.provider).toBe('anilist');
    expect(loadRecos).toHaveBeenCalled();
    expect(p.items[0].titre).toBe('Fallback');
  });

  it('uses AniList when MangaBaka returns nothing', async () => {
    MBCACHE[norm(entry.t)] = { mb: 377, titre: 'X', url: 'u' };
    recommendations.mockImplementation(async () => []);
    const p = await recosFor(entry, true);
    expect(p.provider).toBe('anilist');
  });
});
