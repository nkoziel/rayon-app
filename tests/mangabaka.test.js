import { describe, it, expect } from 'vitest';
import { shapeSeries, attributionHTML, ATTRIBUTION_URL } from '../src/data/mangabaka.js';

/* shapeSeries maps MangaBaka's payload onto the shape the rest of the app understands, so
   nothing downstream has to know where a record came from. These fixtures are trimmed from
   real API responses. */

const ONE_PIECE = {
  id: 377,
  title: 'ONE PIECE',
  romanized_title: 'ONE PIECE',
  native_title: 'ONE PIECE',
  type: 'manga',
  status: 'releasing',
  year: 1997,
  total_chapters: '1191',
  final_volume: '115',
  description: 'As a child, Monkey D. Luffy was inspired to become a pirate…',
  popularity: { global: 12345 },
  genres: ['Action', 'Adventure', { name: 'Comedy' }],
  authors: [{ name: 'Eiichiro Oda' }],
  artists: [],
  titles: [
    { title: 'ONE PIECE', language: 'en' },
    { title: 'ワンピース', language: 'ja' },
    { title: '원피스', language: 'ko' },
  ],
  cover: {
    raw: { url: 'https://images.mangabaka.dev/raw.jpg', blurhash: '|PNvoBxu' },
    x150: { x1: 'a150@1', x2: 'a150@2' },
    x250: { x1: 'a250@1', x2: 'a250@2' },
    x350: { x1: 'a350@1', x2: 'a350@2' },
  },
  source: {
    anilist:       { id: 30013, rating_normalized: 91 },
    my_anime_list: { id: 13,    rating_normalized: 92 },
    kitsu:         { id: 1,     rating_normalized: 85 },
    anime_news_network: { id: null, rating_normalized: null },
  },
};

describe('shapeSeries', () => {
  const m = shapeSeries(ONE_PIECE);

  it('keeps both identities: the MangaBaka id and the AniList one', () => {
    expect(m.mb).toBe(377);
    expect(m.id).toBe(30013);
  });

  it('coerces the string counts the API returns into numbers', () => {
    /* total_chapters and final_volume come back as strings; arithmetic downstream would
       silently concatenate instead of adding. */
    expect(m.chapitres).toBe(1191);
    expect(m.volumes).toBe(115);
    expect(typeof m.chapitres).toBe('number');
  });

  it('fills volume and chapter counts for an ONGOING series', () => {
    /* This is precisely AniList's documented blind spot, and the reason for the migration. */
    expect(m.statut).toBe('releasing');
    expect(m.chapitres).toBeGreaterThan(0);
    expect(m.volumes).toBeGreaterThan(0);
  });

  it('averages only the databases that actually rated it', () => {
    /* 91, 92, 85 -> 89. The null-rated source must not drag the average down. */
    expect(m.score).toBe(89);
    expect(m.sources).toBe(3);
  });

  it('flattens the cover tree but keeps the blurhash placeholder', () => {
    expect(m.cover).toBe('a350@2');
    expect(m.blurhash).toBe('|PNvoBxu');
  });

  it('collects every alternative title, which is what makes fuzzy matching work', () => {
    expect(m.aliases).toContain('ワンピース');
    expect(m.aliases).toContain('원피스');
  });

  it('accepts genres as plain strings or as objects', () => {
    expect(m.genres).toEqual(['Action', 'Adventure', 'Comedy']);
  });

  it('joins authors and artists', () => {
    expect(m.auteur).toBe('Eiichiro Oda');
  });

  it('capitalises the type for display', () => {
    expect(m.type).toBe('Manga');
  });
});

describe('shapeSeries — missing data', () => {
  it('returns null for nothing', () => {
    expect(shapeSeries(null)).toBeNull();
    expect(shapeSeries(undefined)).toBeNull();
  });

  it('survives a series with no cover, no ratings and no titles', () => {
    const m = shapeSeries({ id: 1, title: 'X' });
    expect(m.cover).toBe('');
    expect(m.blurhash).toBe('');
    expect(m.score).toBeNull();
    expect(m.aliases).toEqual([]);
    expect(m.id).toBeNull();          // no AniList id is a valid state
  });

  it('reports no total rather than zero when counts are absent', () => {
    const m = shapeSeries({ id: 1, title: 'X' });
    expect(m.chapitres).toBeNull();
    expect(m.volumes).toBeNull();
  });
});

describe('attribution — a licence condition, not a courtesy', () => {
  it('links to MangaBaka and names the licence', () => {
    const html = attributionHTML();
    expect(html).toContain(ATTRIBUTION_URL);
    expect(html).toContain('CC BY-NC-SA 4.0');
  });
});
