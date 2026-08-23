import { describe, it, expect } from 'vitest';
import { consolidateMihon } from '../src/import/tachibk.js';

/* A Mihon backup keeps every series you ever opened, one row per source. The shapes here are the
   ones measured in a real 232-entry backup: 118 favourites, 114 un-favourited, 43 duplicated
   titles, and six titles whose favourite copy held LESS progress than the copy it replaced. */

const e = (t, f, r, n, extra = {}) => ({ t, f, r, n, d: '', al: 0, ...extra });

describe('consolidateMihon', () => {
  it('keeps the favourite copy and drops the abandoned sources', () => {
    const { entries, dropped } = consolidateMihon([
      e('Villain To Kill', 1, 249, 249, { s: 'Asura Scans' }),
      e('Villain To Kill', 0, 182, 182, { s: 'MangaK' }),
      e('Villain To Kill', 0, 134, 134, { s: 'Mangakakalot' }),
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0].s).toBe('Asura Scans');
    expect(dropped).toBe(0);      // folded, not dropped
  });

  it('carries progress forward when the favourite copy is behind', () => {
    /* Berserk in the real backup: favourite at 0 read, abandoned copy at 393. Dropping the row
       outright would have silently erased 393 chapters. */
    const { entries } = consolidateMihon([
      e('Berserk', 1, 0, 441, { s: 'Mangakakalot' }),
      e('Berserk', 0, 393, 395, { s: 'MangaPanda' }),
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0].s).toBe('Mangakakalot');   // the favourite still wins as the row
    expect(entries[0].r).toBe(393);              // but progress never moves backwards
  });

  it('never lets progress move backwards when the favourite is already ahead', () => {
    const { entries } = consolidateMihon([
      e('The Live', 1, 167, 167),
      e('The Live', 0, 100, 177),
    ]);
    expect(entries[0].r).toBe(167);
    expect(entries[0].n).toBe(177);
  });

  it('drops a title with no favourite copy at all', () => {
    const { entries, dropped } = consolidateMihon([
      e('Sweet Guy', 0, 86, 86),
      e('Spirit Sword Sovereign', 0, 0, 533),
    ]);
    expect(entries).toHaveLength(0);
    expect(dropped).toBe(2);
  });

  it('leaves two favourites under one title alone instead of merging them', () => {
    /* Two favourites is a deliberate choice - a spin-off sharing a title, say - so neither
       should inherit the other's progress. */
    const { entries } = consolidateMihon([
      e('Versus', 1, 53, 60, { s: 'A' }),
      e('Versus', 1, 10, 60, { s: 'B' }),
      e('Versus', 0, 33, 33, { s: 'C' }),
    ]);
    expect(entries).toHaveLength(2);
    expect(entries.map(x => x.r).sort((a, b) => a - b)).toEqual([10, 53]);
  });

  it('does not fold two different AniList ids sharing a title', () => {
    const { entries, dropped } = consolidateMihon([
      e('Ping', 1, 5, 30, { al: 111 }),
      e('Ping', 0, 900, 900, { al: 222 }),
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0].r).toBe(5);
    expect(dropped).toBe(1);
  });

  it('adopts an AniList id the favourite copy lacks', () => {
    const { entries } = consolidateMihon([
      e('Kingdom', 1, 700, 700, { al: 0 }),
      e('Kingdom', 0, 100, 100, { al: 30642 }),
    ]);
    expect(entries[0].al).toBe(30642);
  });

  it('takes the most recent read date along with the progress it belongs to', () => {
    const { entries } = consolidateMihon([
      e('Frieren', 1, 10, 20, { d: '2026-01-01' }),
      e('Frieren', 0, 99, 99, { d: '2026-08-01' }),
    ]);
    expect(entries[0].r).toBe(99);
    expect(entries[0].d).toBe('2026-08-01');
  });

  it('never reports more chapters read than the series has', () => {
    const { entries } = consolidateMihon([
      e('Dungeon Reset', 1, 0, 269),
      e('Dungeon Reset', 0, 356, 356),
    ]);
    expect(entries[0].n).toBeGreaterThanOrEqual(entries[0].r);
  });

  it('matches titles the way the rest of the app does, accents and punctuation aside', () => {
    const { entries } = consolidateMihon([
      e("The Novel's Extra", 1, 168, 170),
      e('The Novel’S Extra', 0, 125, 125),
    ]);
    expect(entries).toHaveLength(1);
  });

  it('leaves a library of favourites untouched', () => {
    const rows = [e('A', 1, 1, 2), e('B', 1, 3, 4), e('C', 1, 5, 6)];
    const { entries, dropped, folded } = consolidateMihon(rows);
    expect(entries).toHaveLength(3);
    expect(dropped).toBe(0);
    expect(folded).toBe(0);
  });
});
