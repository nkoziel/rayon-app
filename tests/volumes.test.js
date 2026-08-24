import { describe, it, expect } from 'vitest';
import {
  parseVolumes, formatVolumes, ownsVolume, toggleVolume, addRange,
  countVolumes, missingVolumes, gapVolumes, isComplete,
  gridSize, lastOwned, volumeBar, GRID_MIN, GRID_SLACK,
} from '../src/core/volumes.js';

/* Owned volumes are stored as a range string on the entry: "1-7,9,12-14".
   Compact on purpose — forty booleans per series across a library is the growth that made
   localStorage overflow before (REVIEW.md §1.2). */

describe('parseVolumes', () => {
  it.each([
    ['1-7,9,12-14', [1,2,3,4,5,6,7,9,12,13,14]],
    ['3',           [3]],
    ['1,2,3',       [1,2,3]],
    ['5-5',         [5]],
    ['',            []],
    [null,          []],
    [undefined,     []],
  ])('%s -> %j', (input, expected) => {
    expect(parseVolumes(input)).toEqual(expected);
  });

  it('accepts a reversed range', () => {
    expect(parseVolumes('7-1')).toEqual([1,2,3,4,5,6,7]);
  });

  it('tolerates whitespace and stray separators', () => {
    expect(parseVolumes(' 1 - 3 , , 5 ')).toEqual([1,2,3,5]);
  });

  it('drops junk instead of throwing, since this can come from an imported file', () => {
    expect(parseVolumes('abc,2,-,4')).toEqual([2,4]);
  });

  it('deduplicates overlapping ranges', () => {
    expect(parseVolumes('1-5,3-7')).toEqual([1,2,3,4,5,6,7]);
  });

  it('refuses an absurd range rather than hanging', () => {
    expect(parseVolumes('1-99999')).toEqual([]);
  });
});

describe('formatVolumes — always the shortest canonical form', () => {
  it.each([
    [[1,2,3,5],            '1-3,5'],
    [[1],                  '1'],
    [[],                   ''],
    [[3,1,2],              '1-3'],
    [[1,1,2],              '1-2'],
    [[1,3,5],              '1,3,5'],
    [[1,2,3,4,5],          '1-5'],
  ])('%j -> %s', (input, expected) => {
    expect(formatVolumes(input)).toBe(expected);
  });

  it('round-trips through parse without drift', () => {
    for (const s of ['1-7,9,12-14', '1', '', '2,4,6', '1-3,5-9']) {
      expect(formatVolumes(parseVolumes(s))).toBe(s);
    }
  });
});

describe('toggleVolume', () => {
  it('adds a volume that is missing', () => {
    expect(toggleVolume('1-3', 5)).toBe('1-3,5');
  });

  it('removes a volume that is owned', () => {
    expect(toggleVolume('1-3', 2)).toBe('1,3');
  });

  it('closes a range when the added volume bridges it', () => {
    expect(toggleVolume('1-3,5', 4)).toBe('1-5');
  });

  it('works from empty', () => {
    expect(toggleVolume('', 1)).toBe('1');
  });
});

describe('addRange — "I own 1 to 12" in one gesture', () => {
  it('adds a whole run', () => {
    expect(addRange('', 1, 12)).toBe('1-12');
  });

  it('merges with what is already there', () => {
    expect(addRange('15', 1, 12)).toBe('1-12,15');
  });

  it('accepts the bounds in either order', () => {
    expect(addRange('', 12, 1)).toBe('1-12');
  });
});

describe('missingVolumes — the shopping list for one series', () => {
  it('lists what is missing up to the known total', () => {
    expect(missingVolumes('1-3,5', 6)).toEqual([4, 6]);
  });

  it('returns nothing when the collection is complete', () => {
    expect(missingVolumes('1-6', 6)).toEqual([]);
  });

  it('does NOT guess when no total is known', () => {
    expect(missingVolumes('1-3', 0)).toEqual([]);
    expect(missingVolumes('1-3', null)).toEqual([]);
  });

  it('lists everything when nothing is owned yet', () => {
    expect(missingVolumes('', 3)).toEqual([1, 2, 3]);
  });
});

describe('gapVolumes — holes in the middle of a shelf', () => {
  it('finds a hole between owned volumes', () => {
    expect(gapVolumes('1-3,5-7')).toEqual([4]);
  });

  it('ignores volumes above the highest owned one', () => {
    /* Those are "not bought yet", not a gap. */
    expect(gapVolumes('1-3')).toEqual([]);
  });

  it('needs no total to work', () => {
    expect(gapVolumes('1,5')).toEqual([2,3,4]);
  });
});

describe('countVolumes / isComplete', () => {
  it('counts what is owned', () => {
    expect(countVolumes('1-7,9')).toBe(8);
  });

  it('is complete only when a total is known and nothing is missing', () => {
    expect(isComplete('1-6', 6)).toBe(true);
    expect(isComplete('1-5', 6)).toBe(false);
    expect(isComplete('1-6', null)).toBe(false);
  });
});

/* The grid used to render only the volumes already owned when no total was known, so a series
   on a device with a cold metadata cache offered nothing to tap and the feature looked broken.
   Reported from Android, where the caches are separate from the desktop's. */
describe('gridSize — the grid has to exist before any total is known', () => {
  it('offers a usable grid for an empty collection with no total', () => {
    expect(gridSize(0, 0)).toBe(GRID_MIN);
    expect(gridSize(null, 0)).toBe(GRID_MIN);
    expect(gridSize(undefined, 0)).toBe(GRID_MIN);
  });

  it('always runs past the last volume owned, so the next one is one tap away', () => {
    expect(gridSize(0, 20)).toBe(20 + GRID_SLACK);
    expect(gridSize(0, 7)).toBe(Math.max(7 + GRID_SLACK, GRID_MIN));
  });

  it('uses the total when there is one', () => {
    expect(gridSize(34, 12)).toBe(34);
  });

  it('never stops short of the collection, even past the published total', () => {
    /* Scantrad and official editions number differently; a volume owned with no cell is a
       volume that cannot be un-ticked. */
    expect(gridSize(34, 36)).toBe(36);
  });
});

describe('lastOwned', () => {
  it.each([['', 0], [null, 0], ['1-3', 3], ['1-3,9', 9], ['12', 12]])('%s -> %i', (s, n) => {
    expect(lastOwned(s)).toBe(n);
  });
});

describe('volumeBar — the shelf at a glance', () => {
  it('gives one mark per volume when the run is short enough', () => {
    expect(volumeBar('1-3', 5)).toEqual(['own','own','own','none','none']);
  });

  it('is empty without a total, rather than guessing a length', () => {
    expect(volumeBar('1-3', 0)).toEqual([]);
    expect(volumeBar('1-3', null)).toEqual([]);
  });

  it('never reports a bucket as owned unless every volume in it is', () => {
    const bar = volumeBar('1-50', 100, 10);       // 10 buckets of 10, first five full
    expect(bar).toEqual(['own','own','own','own','own','none','none','none','none','none']);
    expect(volumeBar('1-45', 100, 10)[4]).toBe('part');
  });

  it('covers the whole run, one bucket per slot', () => {
    expect(volumeBar('1-100', 100, 40)).toHaveLength(40);
    expect(volumeBar('1-100', 100, 40).every(x => x === 'own')).toBe(true);
  });
});
