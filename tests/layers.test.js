import { describe, it, expect, beforeEach, vi } from 'vitest';
import { openLayer, replaceLayer, closeLayer, layerOpen, resetLayers } from '../src/ui/layers.js';

/* On Android back is how you dismiss things. Nothing here ever pushed a history entry, so back
   popped the only entry there was and left the app: "I open a series, press back to close it,
   and the whole app exits."

   The invariant these cases protect is not "back closes the sheet" — it is that a history entry
   is pushed exactly once per overlay and consumed exactly once, whichever control does the
   closing. Get that wrong and the bug becomes intermittent: a leftover entry makes the NEXT
   back press silently do nothing. */

/* A history stub that fires popstate the way a browser does. */
function stubHistory(){
  const entries = [];
  history.pushState = vi.fn(() => { entries.push(1); });
  history.back = vi.fn(() => {
    if (!entries.length) return;
    entries.pop();
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  return entries;
}

beforeEach(() => { resetLayers(); });

describe('openLayer / closeLayer', () => {
  it('pushes one entry per overlay and tears down when it is popped', () => {
    const entries = stubHistory();
    const closed = vi.fn();
    openLayer(closed);
    expect(entries).toHaveLength(1);
    expect(layerOpen()).toBe(true);

    closeLayer();
    expect(closed).toHaveBeenCalledTimes(1);
    expect(entries).toHaveLength(0);
    expect(layerOpen()).toBe(false);
  });

  it('tears down on a back press that the app did not initiate', () => {
    stubHistory();
    const closed = vi.fn();
    openLayer(closed);
    window.dispatchEvent(new PopStateEvent('popstate'));   // the hardware back button
    expect(closed).toHaveBeenCalledTimes(1);
    expect(layerOpen()).toBe(false);
  });

  it('never tears down twice for one overlay', () => {
    /* The trap: a control that closes directly AND a popstate that closes again. */
    stubHistory();
    const closed = vi.fn();
    openLayer(closed);
    closeLayer();
    closeLayer();                                           // second press, nothing left
    expect(closed).toHaveBeenCalledTimes(1);
  });

  it('reports false when nothing is open, so callers can close directly', () => {
    stubHistory();
    expect(closeLayer()).toBe(false);
  });

  it('leaves no entry behind, so the next back press still acts', () => {
    const entries = stubHistory();
    openLayer(() => {});
    closeLayer();
    openLayer(() => {});
    expect(entries).toHaveLength(1);   // not 2 — the first was consumed
  });
});

describe('replaceLayer — one sheet opening another', () => {
  it('swaps the teardown without deepening history', () => {
    const entries = stubHistory();
    const first = vi.fn(), second = vi.fn();
    openLayer(first);
    replaceLayer(second);
    expect(entries).toHaveLength(1);

    closeLayer();
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();   // the stale sheet must not be torn down twice
  });

  it('opens a layer when none is open yet', () => {
    const entries = stubHistory();
    const closed = vi.fn();
    replaceLayer(closed);
    expect(entries).toHaveLength(1);
    closeLayer();
    expect(closed).toHaveBeenCalledTimes(1);
  });
});

describe('nesting', () => {
  it('closes the innermost overlay first', () => {
    stubHistory();
    const outer = vi.fn(), inner = vi.fn();
    openLayer(outer);
    openLayer(inner);

    closeLayer();
    expect(inner).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();

    closeLayer();
    expect(outer).toHaveBeenCalledTimes(1);
  });
});
