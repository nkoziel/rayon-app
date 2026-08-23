import { describe, it, expect } from 'vitest';
import { mergeLibraries } from '../src/import/library.js';

/* REVIEW.md §1.5 — importing used to replace the library outright, with no confirmation and
   no undo, and a drag-and-drop reached it directly. Merging is what makes swapping lists
   between friends usable, and it has one governing rule:

     PROGRESS NEVER MOVES BACKWARDS.

   Importing a friend's list, or an older backup of your own, must not undo what you read. */

const at = (list, t) => list.find(e => e.t === t);

describe('mergeLibraries — the no-regression rule', () => {
  it('keeps the higher progress when the incoming side is behind', () => {
    const r = mergeLibraries(
      [{ t: 'One Piece', al: 30013, r: 900 }],
      [{ t: 'One Piece', al: 30013, r: 500 }]);
    expect(at(r.entries, 'One Piece').r).toBe(900);
  });

  it('adopts the higher progress when the incoming side is ahead', () => {
    const r = mergeLibraries(
      [{ t: 'One Piece', al: 30013, r: 500 }],
      [{ t: 'One Piece', al: 30013, r: 900 }]);
    expect(at(r.entries, 'One Piece').r).toBe(900);
    expect(r.updated).toBe(1);
  });

  it('applies the same rule to volumes', () => {
    const r = mergeLibraries(
      [{ t: 'Berserk', al: 30002, r: 0, rv: 40 }],
      [{ t: 'Berserk', al: 30002, r: 0, rv: 12 }]);
    expect(at(r.entries, 'Berserk').rv).toBe(40);
  });
});

describe('mergeLibraries — matching', () => {
  it('matches on the AniList id', () => {
    const r = mergeLibraries(
      [{ t: 'One Piece', al: 30013, r: 900 }],
      [{ t: 'ONE PIECE', al: 30013, r: 100 }]);
    expect(r.entries).toHaveLength(1);
  });

  it('matches on title when neither side has an id', () => {
    const r = mergeLibraries([{ t: 'Berserk', al: 0, r: 10 }], [{ t: 'Berserk', al: 0, r: 20 }]);
    expect(r.entries).toHaveLength(1);
    expect(at(r.entries, 'Berserk').r).toBe(20);
  });

  it('matches on title when only ONE side has an id, and does not duplicate', () => {
    /* The common case: a Mihon backup only carries an AniList id when tracking was
       configured. A single composite key duplicated the series here — the bug this caught. */
    const r = mergeLibraries([{ t: 'Vinland Saga', al: 0, r: 5 }],
                             [{ t: 'Vinland Saga', al: 30642, r: 5 }]);
    expect(r.entries).toHaveLength(1);
    expect(at(r.entries, 'Vinland Saga').al).toBe(30642);
  });

  it('keeps two DIFFERENT series that share a title apart', () => {
    const r = mergeLibraries([{ t: 'Bleach', al: 11, r: 5 }], [{ t: 'Bleach', al: 22, r: 7 }]);
    expect(r.entries).toHaveLength(2);
  });

  it('does not merge non-latin titles together', () => {
    /* Depends on the §1.1 fix: with the old norm() every CJK title keyed to "". */
    const r = mergeLibraries([], [{ t: '進撃の巨人', al: 0, r: 1 }, { t: 'ワンピース', al: 0, r: 2 }]);
    expect(r.entries).toHaveLength(2);
  });
});

describe('mergeLibraries — filling gaps without overwriting', () => {
  it('adopts a manual total only when we have none', () => {
    const kept = mergeLibraries([{ t: 'A', al: 1, r: 1, manCh: 50 }],
                                [{ t: 'A', al: 1, r: 1, manCh: 10 }]);
    expect(at(kept.entries, 'A').manCh).toBe(50);

    const filled = mergeLibraries([{ t: 'A', al: 1, r: 1 }],
                                  [{ t: 'A', al: 1, r: 1, manCh: 10 }]);
    expect(at(filled.entries, 'A').manCh).toBe(10);
  });

  it('keeps the more recent read date', () => {
    const r = mergeLibraries([{ t: 'A', al: 1, r: 1, d: '2026-08-02' }],
                             [{ t: 'A', al: 1, r: 1, d: '2026-07-01' }]);
    expect(at(r.entries, 'A').d).toBe('2026-08-02');
  });

  it('adds a genuinely new series and counts it', () => {
    const r = mergeLibraries([{ t: 'A', al: 1, r: 5 }], [{ t: 'B', al: 2, r: 3 }]);
    expect(r.entries).toHaveLength(2);
    expect(r.added).toBe(1);
  });
});

describe('mergeLibraries — does not mutate its inputs', () => {
  it('leaves the current library untouched', () => {
    const current = [{ t: 'A', al: 1, r: 5 }];
    mergeLibraries(current, [{ t: 'A', al: 1, r: 50 }]);
    expect(current[0].r).toBe(5);
  });
});
