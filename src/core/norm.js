/* Title normalisation, used for fuzzy matching and import merging only — NEVER as a cache key.
   WARNING: do NOT go back to [^a-z0-9] — it stripped every non-ASCII character, so
   "進撃の巨人", "나 혼자만 레벨업" and "ワンピース" all collapsed to "" and overwrote each
   other in META, OWNED, MDCACHE and the reco: caches. (REVIEW.md §1.1)

   The .normalize("NFC") is not cosmetic: NFD decomposes ピ into ヒ + handakuten (U+309A),
   which is a mark and not a letter — without recomposing, [^\p{L}\p{N}] strips it and
   "ワンピース" becomes "ワンヒース". Worse, パパ collides with ハハ. */
export const norm = s => (s||"").toLowerCase().normalize("NFD")
  .replace(/[̀-ͯ]/g,"")            // latin diacritics only: é -> e
  .normalize("NFC")                  // RECOMPOSE before filtering — see above
  .replace(/[^\p{L}\p{N}]/gu,"");   // keep letters and digits of EVERY script
