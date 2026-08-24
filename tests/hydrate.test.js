import { describe, it, expect } from 'vitest';
import { mapLimit } from '../src/data/hydrate.js';

/* Hydration used to resolve one series at a time, strictly sequentially. On a phone with a
   large library that is a run that never finishes — which is how it was reported: the volume
   grid and the shopping list both need a volume count, and neither ever got one.
   mapLimit is the whole of that change worth pinning: it must process every item exactly once
   and never exceed the limit, because mbGet() shares one 429 cooldown across the app. */

const tick = () => new Promise(r => setTimeout(r, 1));

describe('mapLimit', () => {
  it('processes every item exactly once', async () => {
    const seen = [];
    await mapLimit([1,2,3,4,5,6,7], 3, async n => { await tick(); seen.push(n); });
    expect(seen.sort((a,b)=>a-b)).toEqual([1,2,3,4,5,6,7]);
  });

  it('never runs more than `limit` at a time', async () => {
    let live = 0, peak = 0;
    await mapLimit(Array.from({length: 20}, (_,i)=>i), 4, async () => {
      live++; peak = Math.max(peak, live);
      await tick();
      live--;
    });
    expect(peak).toBe(4);
  });

  it('is actually concurrent, not sequential', async () => {
    /* Without this the limit could be honoured by a loop that runs one at a time. */
    let live = 0, peak = 0;
    await mapLimit([1,2,3,4], 4, async () => {
      live++; peak = Math.max(peak, live); await tick(); live--;
    });
    expect(peak).toBeGreaterThan(1);
  });

  it('handles a list shorter than the limit, and an empty one', async () => {
    const seen = [];
    await mapLimit([1,2], 10, async n => { seen.push(n); });
    expect(seen).toEqual([1,2]);
    await expect(mapLimit([], 4, async () => { throw new Error('never'); })).resolves.toBeUndefined();
  });

  it('a free worker takes the next item instead of waiting on a slow one', async () => {
    /* Timing-based versions of this are flaky; the ordering is controlled explicitly instead.
       Item 0 is held open, so if the run were lock-step nothing else could finish. */
    const gate = {};
    const held = new Promise(res => { gate.release = res; });
    const finished = [];

    const run = mapLimit([0, 1, 2, 3], 2, async n => {
      if (n === 0) await held;
      finished.push(n);
    });

    /* Let the free worker drain 1, 2 and 3 while 0 is still blocked. */
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(finished).toEqual([1, 2, 3]);

    gate.release();
    await run;
    expect(finished).toEqual([1, 2, 3, 0]);
  });
});
