import { describe, it, expect } from 'vitest';
import { whyHTML, mergeWhy, strengthOf } from '../src/ui/why.js';

/* The badges are the only place a reader is told WHY a title was suggested, so the mapping from
   signal to badge has to be exact: a badge that shows up without its signal is a lie, and one
   that goes missing throws away the reason. */

const why = (o = {}) => ({ kind: 'similar', score: 0, sameAuthor: false, sharedUsers: 0, tags: [], tagsTotal: 0, ...o });

describe('whyHTML', () => {
  it('shows one badge per signal present, and none for absent signals', () => {
    const html = whyHTML({ why: why({ sharedUsers: 14, tags: ['Gore'], tagsTotal: 6, sameAuthor: true }) });
    expect(html).toContain('why-readers');
    expect(html).toContain('why-tags');
    expect(html).toContain('why-author');
  });

  it('omits the readers badge when nobody shares the two', () => {
    const html = whyHTML({ why: why({ tags: ['Gore'], tagsTotal: 3 }) });
    expect(html).not.toContain('why-readers');
    expect(html).toContain('why-tags');
  });

  it('omits the author badge unless the author actually matched', () => {
    expect(whyHTML({ why: why({ sharedUsers: 5 }) })).not.toContain('why-author');
  });

  it('still shows a tag badge when the names were truncated away but the count survived', () => {
    /* MangaBaka returns shared_tags_total in the dozens and truncates the name list. */
    const html = whyHTML({ why: why({ tags: [], tagsTotal: 50 }) });
    expect(html).toContain('why-tags');
    expect(html).toContain('50');
  });

  it('puts the tag names in the tooltip, not in the badge label', () => {
    const html = whyHTML({ why: why({ tags: ['Gore', 'Revenge'], tagsTotal: 12 }) });
    expect(html).toContain('title="Gore, Revenge"');
    expect(html).toContain('12');
  });

  it('falls back to a readers badge for AniList items, which only ever had a vote count', () => {
    const html = whyHTML({ votes: 7, genres: ['Action'] });
    expect(html).toContain('why-readers');
    expect(html).toContain('7');
    expect(html).not.toContain('why-author');
  });

  it('escapes hostile tag names rather than injecting them', () => {
    const html = whyHTML({ why: why({ tags: ['<img onerror=x>'], tagsTotal: 1 }) });
    expect(html).not.toContain('<img');
  });
});

describe('mergeWhy', () => {
  it('keeps evidence from both seeds instead of letting the second overwrite the first', () => {
    const m = mergeWhy(why({ tags: ['Gore'], tagsTotal: 4 }), why({ sharedUsers: 9, sameAuthor: true }));
    expect(m.tags).toContain('Gore');
    expect(m.sharedUsers).toBe(9);
    expect(m.sameAuthor).toBe(true);
    expect(m.tagsTotal).toBe(4);
  });

  it('does not duplicate a tag seen from two seeds', () => {
    const m = mergeWhy(why({ tags: ['Gore', 'War'] }), why({ tags: ['War', 'Revenge'] }));
    expect(m.tags).toEqual(['Gore', 'War', 'Revenge']);
  });

  it('survives either side being absent', () => {
    const w = why({ sharedUsers: 3 });
    expect(mergeWhy(null, w)).toBe(w);
    expect(mergeWhy(w, null)).toBe(w);
  });
});

describe('strengthOf', () => {
  it('ranks a MangaBaka item above a weaker one', () => {
    expect(strengthOf({ why: why({ sharedUsers: 30, score: 0.5 }) }))
      .toBeGreaterThan(strengthOf({ why: why({ sharedUsers: 5, score: 0.1 }) }));
  });

  it('falls back to the AniList vote count when there is no why', () => {
    expect(strengthOf({ votes: 12 })).toBe(12);
  });

  it('never returns NaN for an item with neither', () => {
    expect(strengthOf({})).toBe(0);
  });
});
