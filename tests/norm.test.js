import { describe, it, expect } from 'vitest';
import { norm } from '../src/core/norm.js';

/* REVIEW.md §1.1 — norm() used to be `[^a-z0-9]`, which stripped every non-ASCII character.
   Every Japanese, Korean and Chinese title collapsed to "", and since norm(title) keyed
   META, MDCACHE, OWNED and the reco caches, all of them shared one record. */

describe('norm — latin behaviour is unchanged', () => {
  it.each([
    ['One Piece',      'onepiece'],
    ['Pokémon',        'pokemon'],
    ['Ké Nöël & Co',   'kenoelco'],
    ['One Piece!',     'onepiece'],
    ['  spaced  out ', 'spacedout'],
  ])('%s -> %s', (input, expected) => {
    expect(norm(input)).toBe(expected);
  });
});

describe('norm — non-latin titles survive', () => {
  it.each([
    ['進撃の巨人',        '進撃の巨人'],
    ['ワンピース',        'ワンピース'],
    ['斗罗大陆',          '斗罗大陆'],
    ['나 혼자만 레벨업',  '나혼자만레벨업'],
  ])('%s -> %s', (input, expected) => {
    expect(norm(input)).toBe(expected);
  });

  it('never produces an empty key for a titled series', () => {
    for (const t of ['進撃の巨人', 'ワンピース', '斗罗大陆', '나 혼자만 레벨업'])
      expect(norm(t)).not.toBe('');
  });

  it('keeps distinct titles distinct', () => {
    const titles = ['進撃の巨人', 'ワンピース', '斗罗大陆', '나 혼자만 레벨업', 'One Piece'];
    expect(new Set(titles.map(norm)).size).toBe(titles.length);
  });
});

describe('norm — the NFC step', () => {
  /* NFD decomposes ピ into ヒ + handakuten (U+309A), which is a MARK, not a letter — so
     [^\p{L}\p{N}] strips it. Without recomposing first, ワンピース becomes ワンヒース and,
     worse, パパ collides with ハハ. This caught a real bug before it shipped. */
  it('preserves dakuten and handakuten', () => {
    expect(norm('ワンピース')).toBe('ワンピース');
    expect(norm('ゲゲゲの鬼太郎')).toBe('ゲゲゲの鬼太郎');
  });

  it('does not collide パパ with ハハ', () => {
    expect(norm('パパ')).not.toBe(norm('ハハ'));
  });

  it('does not collide ばか with はか', () => {
    expect(norm('ばか')).not.toBe(norm('はか'));
  });
});

describe('norm — edge cases', () => {
  it.each([[null], [undefined], ['']])('%s is safe', (input) => {
    expect(norm(input)).toBe('');
  });
});
