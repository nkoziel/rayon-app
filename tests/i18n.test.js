import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { t, setLocale, locale, AVAILABLE, missingKeys } from '../src/core/i18n.js';

/* English is the default so the app is easy to share; French is a COMPLETE alternative,
   because the owner uses it in French. A key missing from French silently showing English
   is a bug, not graceful degradation — hence the completeness test below. */

beforeEach(() => { setLocale('en'); });

describe('i18n — every locale is complete', () => {
  it('has no missing or extra keys in any locale', () => {
    expect(missingKeys()).toEqual({});
  });

  it('ships exactly the locales it advertises', () => {
    expect(AVAILABLE).toEqual(['en', 'fr']);
  });
});

describe('i18n — lookup', () => {
  it('returns the string for the active locale', () => {
    setLocale('fr');
    expect(t('btn.import')).toBe('Importer');
    setLocale('en');
    expect(t('btn.import')).toBe('Import');
  });

  it('returns the KEY for an unknown lookup, so it is visible and greppable', () => {
    expect(t('nope.does.not.exist')).toBe('nope.does.not.exist');
  });

  it('interpolates named placeholders', () => {
    expect(t('import.reading', { name: 'backup.tachibk' })).toContain('backup.tachibk');
  });

  it('leaves an unknown placeholder alone rather than printing undefined', () => {
    expect(t('import.reading', {})).toContain('{name}');
  });
});

describe('i18n — plurals go through Intl.PluralRules', () => {
  it('uses the singular form in French for 1', () => {
    setLocale('fr');
    expect(t('toast.imported', { n: 1 })).toBe('1 série importée');
  });

  it('uses the plural form in French for 2', () => {
    setLocale('fr');
    expect(t('toast.imported', { n: 2 })).toBe('2 séries importées');
  });

  it('handles the filter summary noun in both languages', () => {
    setLocale('fr');
    expect(t('filter.summary', { n: 1 })).toBe('série');
    expect(t('filter.summary', { n: 3 })).toBe('séries');
    setLocale('en');
    expect(t('filter.summary', { n: 1 })).toBe('series');
  });
});

describe('i18n — locale selection', () => {
  it('refuses a locale it does not have', () => {
    setLocale('en');
    expect(setLocale('de')).toBe(false);
    expect(locale()).toBe('en');
  });

  it('reflects the choice on the document element', () => {
    setLocale('fr');
    expect(document.documentElement.lang).toBe('fr');
  });
});

describe('i18n — must stay a leaf module', () => {
  /* core/store.js needs t() for its own messages. If i18n imported store back, that is a
     cycle — and since the language is picked at module-init time, the evaluation order would
     leave `store` in its temporal dead zone and throw at boot. It reads its one preference
     key from localStorage directly for exactly this reason. */
  it('imports nothing', () => {
    /* read by path from the project root: under happy-dom, import.meta.url is not a file: URL */
    const src = readFileSync('src/core/i18n.js', 'utf8');
    expect(src).not.toMatch(/^\s*import\s/m);
  });
});
