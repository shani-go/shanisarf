// Ported from CAMeL Tools utils/dediac.py (version 1.6.0).
// Copyright 2018-2026 New York University Abu Dhabi. MIT License.
// The upstream license is reproduced in licenses/CAMEL_TOOLS_LICENSE; see NOTICE.
// shanisarf's changes are Copyright 2026 shani-go (https://github.com/shani-go), MIT License.
//
// Dediacritization in the five encoding schemes. Each function removes every
// code point of its encoding's diacritic set and nothing else, by a global
// replace, exactly as upstream's `dediac_*` do: upstream compiles a regular
// expression that is a character class of the encoding's diacritic frozenset
// and calls `re.sub(regex, '', s)`, replacing every match.
//
// The port translates each regex literally. The character class comes from
// `charsets.ts`'s diacritic class fragments (the same code points,
// metacharacters escaped), the pattern is compiled once with the `g` and `u`
// flags so the replace is global and code-point aware, and the replacement is
// a function returning the empty string so the replacement text stays inert: a
// diacritic can never be a `$`-template, but a function replacer makes that
// true by construction.

import {
  AR_DIAC_CLASS,
  BW_DIAC_CLASS,
  HSB_DIAC_CLASS,
  SAFEBW_DIAC_CLASS,
  XMLBW_DIAC_CLASS,
} from './charsets.js';

/** The empty-string replacer; keeps the replacement text inert (Req 1.7). */
function drop(): string {
  return '';
}

const AR_DIAC_RE = new RegExp(`[${AR_DIAC_CLASS}]`, 'gu');
const BW_DIAC_RE = new RegExp(`[${BW_DIAC_CLASS}]`, 'gu');
const SAFEBW_DIAC_RE = new RegExp(`[${SAFEBW_DIAC_CLASS}]`, 'gu');
const XMLBW_DIAC_RE = new RegExp(`[${XMLBW_DIAC_CLASS}]`, 'gu');
const HSB_DIAC_RE = new RegExp(`[${HSB_DIAC_CLASS}]`, 'gu');

/**
 * Remove the Arabic (native Unicode) diacritics — every code point of
 * `AR_DIAC_CHARSET` — from `s`, leaving everything else untouched.
 */
export function dediacAr(s: string): string {
  return s.replace(AR_DIAC_RE, drop);
}

/**
 * Remove the Buckwalter (BW) diacritics — every code point of
 * `BW_DIAC_CHARSET` — from `s`.
 */
export function dediacBw(s: string): string {
  return s.replace(BW_DIAC_RE, drop);
}

/**
 * Remove the Safe Buckwalter (SAFEBW) diacritics — every code point of
 * `SAFEBW_DIAC_CHARSET` — from `s`.
 */
export function dediacSafebw(s: string): string {
  return s.replace(SAFEBW_DIAC_RE, drop);
}

/**
 * Remove the XML Buckwalter (XMLBW) diacritics — every code point of
 * `XMLBW_DIAC_CHARSET` — from `s`.
 */
export function dediacXmlbw(s: string): string {
  return s.replace(XMLBW_DIAC_RE, drop);
}

/**
 * Remove the Habash-Soudi-Buckwalter (HSB) diacritics — every code point of
 * `HSB_DIAC_CHARSET` — from `s`.
 */
export function dediacHsb(s: string): string {
  return s.replace(HSB_DIAC_RE, drop);
}
