// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// A small hand-made ALMOR database for the Generator and Reinflector unit
// tests. The words are invented or single common words; the features are a
// minimal subset of an MSA database's. Every prefix category has a TABLE AB
// row, which CAMeL Tools' analyzer requires.

/** A noun lemma with two stems, a verb lemma with three, an adjective. */
export const MINI_DB = [
  "###DEFINES###",
  "DEFINE pos pos:noun pos:verb pos:adj",
  "DEFINE asp asp:p asp:i asp:na",
  "DEFINE per per:1 per:3 per:na",
  "DEFINE gen gen:m gen:f",
  "DEFINE num num:s num:p",
  "DEFINE vox vox:a vox:p vox:na",
  "DEFINE rat rat:y rat:n rat:na",
  "DEFINE stt stt:i stt:d stt:na",
  "DEFINE prc0 prc0:0 prc0:Al_det prc0:na",
  "DEFINE prc1 prc1:0 prc1:wa_conj prc1:na",
  "DEFINE enc0 enc0:0 enc0:3ms_poss enc0:na",
  "DEFINE diac diac:*open*",
  "DEFINE lex lex:*open*",
  "###DEFAULTS###",
  "DEFAULT pos:noun asp:na per:na gen:m num:s vox:na rat:* stt:i prc0:0 prc1:0 enc0:0",
  "DEFAULT pos:verb asp:* per:* gen:* num:* vox:a rat:na stt:na prc0:0 prc1:0 enc0:0",
  "DEFAULT pos:adj gen:m num:s stt:i prc0:* prc1:0 enc0:0",
  "DEFAULT pos:*",
  "###ORDER###",
  "ORDER pos asp per gen num vox rat stt prc1 prc0 enc0",
  "###TOKENIZATIONS###",
  "TOKENIZATION diac",
  "###STEMBACKOFF###",
  "STEMBACKOFF ALL N0",
  "###PREFIXES###",
  "\tP0\tdiac: prc0:0 prc1:0",
  "ال\tP1\tdiac:ال prc0:Al_det",
  "و\tP2\tdiac:وَ prc1:wa_conj",
  "ي\tPV\tdiac:يَ per:3 asp:i",
  "###SUFFIXES###",
  "\tS0\tdiac: enc0:0",
  "ه\tS1\tdiac:هُ enc0:3ms_poss",
  "ت\tSV\tdiac:َتْ per:3 gen:f num:s",
  "\tSV0\tdiac:",
  "###STEMS###",
  "كتاب\tN0\tdiac:كِتاب lex:كِتاب_1 pos:noun gen:m num:s rat:n stt:i",
  "كتب\tN1\tdiac:كُتُب lex:كِتاب_1 pos:noun gen:m num:p stt:i",
  "كتب\tV0\tdiac:كَتَب lex:كَتَب_1 pos:verb asp:p per:3 gen:m num:s vox:a",
  "كتب\tV1\tdiac:كُتِب lex:كَتَب_1 pos:verb asp:p per:3 gen:m num:s vox:p",
  "كتب\tV2\tdiac:كْتُب lex:كَتَب_1 pos:verb asp:i per:3 gen:m num:s vox:a",
  "كبير\tA0\tdiac:كَبِير lex:كَبِير_1 pos:adj gen:m num:s stt:i prc0:0",
  "###TABLE AB###",
  "P0 N0",
  "P1 N0",
  "P2 N0",
  "P0 N1",
  "P1 N1",
  "P0 V0",
  "P2 V0",
  "P0 V1",
  "PV V2",
  "P0 A0",
  "P1 A0",
  "###TABLE BC###",
  "N0 S0",
  "N0 S1",
  "N1 S0",
  "V0 SV0",
  "V0 SV",
  "V1 SV0",
  "V2 SV0",
  "A0 S0",
  "###TABLE AC###",
  "P0 S0",
  "P0 S1",
  "P1 S0",
  "P2 S0",
  "P2 S1",
  "P0 SV0",
  "P0 SV",
  "P2 SV0",
  "P2 SV",
  "PV SV0",
  "P1 S1",
].join('\n') + '\n';

/**
 * `MINI_DB` with its stems replaced by three lines of one noun: two identical
 * lines, and a third with the same features in another order. Generation
 * yields three results; reinflection keeps two, equal as dictionaries but
 * with different key orders, as CAMeL Tools' ordered-entries dedup does.
 */
export const DEDUP_DB = MINI_DB.replace(
  /###STEMS###\n[^]*?###TABLE AB###/u,
  [
    '###STEMS###',
    'كتب\tN1\tdiac:كُتُب lex:كُتُب_1 pos:noun gen:m num:p stt:i',
    'كتب\tN1\tdiac:كُتُب lex:كُتُب_1 pos:noun gen:m num:p stt:i',
    'كتب\tN1\tdiac:كُتُب lex:كُتُب_1 num:p gen:m pos:noun stt:i',
    '###TABLE AB###',
  ].join('\n'),
);
