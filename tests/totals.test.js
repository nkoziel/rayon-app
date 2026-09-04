import { describe, it, expect, beforeEach } from 'vitest';
import { totals, unitOf, progressOf } from '../src/data/totals.js';
import { META, MDCACHE, MBCACHE, state } from '../src/core/state.js';
import { norm } from '../src/core/norm.js';

/* The provenance cascade. There is no single reliable source for "how many chapters exist",
   so the app applies a priority order AND tells the user where the number came from:
   manual entry > MangaDex > AniList (finished series only) > the count from the backup.
   REVIEW.md called this out as the first thing worth testing — it is pure logic that fails
   silently, and the README documents it as a specification. */

const KEY = 'testserie';
const entry = (over = {}) => ({ t: 'Test Serie', r: 0, rv: 0, n: 0, origin: 'mihon', ...over });

beforeEach(() => {
  for (const k of Object.keys(META)) delete META[k];
  for (const k of Object.keys(MDCACHE)) delete MDCACHE[k];
  for (const k of Object.keys(MBCACHE)) delete MBCACHE[k];
  state.unit = 'ch';
});

describe('totals — priority order', () => {
  it('falls back to the backup count when nothing else is known', () => {
    const t = totals(entry({ n: 120 }));
    expect(t.ch).toBe(120);
    expect(t.chSrc).toBe('mihon');
  });

  it('labels an imported count as import, not mihon', () => {
    const t = totals(entry({ n: 120, origin: 'import' }));
    expect(t.chSrc).toBe('import');
  });

  it('prefers AniList over the backup count for a finished series', () => {
    META[KEY] = { statut: 'completed', chapitres: 141, volumes: 34 };
    const t = totals(entry({ n: 200 }));
    expect(t.ch).toBe(141);
    expect(t.chSrc).toBe('anilist');
  });

  it('prefers AniList over MangaDex for a finished series', () => {
    /* This was BACKWARDS and produced understated totals: MangaDex reports what has been
       TRANSLATED, not what was published, so Berserk showed 386 chapters when 401 exist. */
    META[KEY] = { statut: 'completed', chapitres: 401 };
    MDCACHE[KEY] = { maxCh: 386 };
    const t = totals(entry());
    expect(t.ch).toBe(401);
    expect(t.chSrc).toBe('anilist');
  });

  it('prefers MangaBaka over everything automatic', () => {
    MDCACHE[KEY] = { maxCh: 386 };
    META[KEY] = { statut: 'completed', chapitres: 401 };
    MBCACHE[KEY] = { chapitres: 405, volumes: 43 };
    const t = totals(entry());
    expect(t.ch).toBe(405);
    expect(t.chSrc).toBe('mangabaka');
    expect(t.volSrc).toBe('mangabaka');
  });

  it('gives MangaBaka counts for an ONGOING series, where AniList has none', () => {
    /* The whole point of the migration: One Piece is releasing, so AniList leaves chapters
       and volumes empty while MangaBaka has both. */
    META[KEY] = { statut: 'releasing', chapitres: null, volumes: null };
    MBCACHE[KEY] = { chapitres: 1191, volumes: 115 };
    const t = totals(entry());
    expect(t.ch).toBe(1191);
    expect(t.vol).toBe(115);
    expect(t.chSrc).toBe('mangabaka');
  });

  it('lets a manual entry beat everything, MangaBaka included', () => {
    META[KEY] = { statut: 'completed', chapitres: 141 };
    MDCACHE[KEY] = { maxCh: 150 };
    MBCACHE[KEY] = { chapitres: 160 };
    const t = totals(entry({ manCh: 999 }));
    expect(t.ch).toBe(999);
    expect(t.chSrc).toBe('manuel');
  });

  it('still falls back to MangaDex when nothing better exists', () => {
    MDCACHE[KEY] = { maxCh: 150 };
    const t = totals(entry());
    expect(t.ch).toBe(150);
    expect(t.chSrc).toBe('mangadex');
  });

  it('reports no total rather than guessing when nothing is known', () => {
    const t = totals(entry());
    expect(t.ch).toBeNull();
    expect(t.chSrc).toBeNull();
  });
});

describe('totals — the AniList blind spot', () => {
  /* AniList only fills `chapters` for FINISHED series. For an ongoing one the field is empty,
     which is a database limitation and not a bug — the cascade must not treat it as truth. */
  it('does not let an ongoing AniList record override MangaDex', () => {
    META[KEY] = { statut: 'releasing', chapitres: 100 };
    MDCACHE[KEY] = { maxCh: 130 };
    expect(totals(entry()).chSrc).toBe('mangadex');
  });

  it('still reads a record cached before the status vocabulary was normalised', () => {
    /* AniList used to be shaped into French labels, so an install predating the token change
       holds "Terminé" in its cache. Dropping that spelling would silently demote every
       finished series in it back to the backup count. */
    META[KEY] = { statut: 'Terminé', chapitres: 401 };
    MDCACHE[KEY] = { maxCh: 386 };
    expect(totals(entry()).ch).toBe(401);
  });
});

describe('unitOf — per-series overrides the global default', () => {
  it('uses the global unit when the series has none', () => {
    state.unit = 'vol';
    expect(unitOf(entry())).toBe('vol');
  });

  it('lets a series pin its own unit', () => {
    state.unit = 'ch';
    expect(unitOf(entry({ unit: 'vol' }))).toBe('vol');
  });
});

describe('progressOf', () => {
  it('computes a percentage against the effective total', () => {
    MDCACHE[KEY] = { maxCh: 200 };
    const p = progressOf(entry({ r: 50 }));
    expect(p.read).toBe(50);
    expect(p.tot).toBe(200);
    expect(p.pct).toBe(25);
    expect(p.remain).toBe(150);
  });

  it('never reports more than 100%, even when progress exceeds the known total', () => {
    MDCACHE[KEY] = { maxCh: 100 };
    expect(progressOf(entry({ r: 150 })).pct).toBe(100);
  });

  it('reports no remainder when no total is known', () => {
    const p = progressOf(entry({ r: 10 }));
    expect(p.tot).toBe(0);
    expect(p.remain).toBeNull();
  });

  it('measures the physical collection on the volume axis, not reading', () => {
    /* Chapters track reading; volumes track what you OWN. A volume owned unread and a
       volume read borrowed are different facts, so the two axes count different things. */
    MDCACHE[KEY] = { maxCh: 200, maxVol: 20 };
    const p = progressOf(entry({ r: 50, ownedVol: '1-5', unit: 'vol' }));
    expect(p.read).toBe(5);
    expect(p.tot).toBe(20);
    expect(p.unit).toBe('vol');
  });

  it('reports the unit as an internal token, never as display text', () => {
    /* It used to be the French label ("tomes"), and callers compared against it to decide what
       to render. That is a comparison against the interface language: the same branch stopped
       matching the moment the app was switched to English. */
    MDCACHE[KEY] = { maxCh: 200, maxVol: 20 };
    expect(progressOf(entry({ ownedVol: '1-5', unit: 'vol' })).unit).toBe('vol');
    expect(progressOf(entry({ r: 10, unit: 'ch' })).unit).toBe('ch');
  });

  it('counts a sparse collection correctly', () => {
    MDCACHE[KEY] = { maxVol: 20 };
    expect(progressOf(entry({ ownedVol: '1-3,7,10-12', unit: 'vol' })).read).toBe(7);
  });

  it('reports nothing owned when the collection is empty', () => {
    MDCACHE[KEY] = { maxVol: 20 };
    const p = progressOf(entry({ r: 99, unit: 'vol' }));
    expect(p.read).toBe(0);   // chapters read must not leak into the volume axis
  });
});

describe('totals — keyed by norm(), so CJK titles do not share a record', () => {
  it('keeps two non-latin series apart', () => {
    META[norm('進撃の巨人')] = { statut: 'completed', chapitres: 141 };
    META[norm('ワンピース')] = { statut: 'releasing', chapitres: null };
    expect(totals({ t: '進撃の巨人', n: 0, origin: 'mihon' }).ch).toBe(141);
    expect(totals({ t: 'ワンピース', n: 0, origin: 'mihon' }).ch).toBeNull();
  });
});
