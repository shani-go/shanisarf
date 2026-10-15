#!/usr/bin/env python3
# shanisarf parity harness. Copyright 2026 shani-go (https://github.com/shani-go), MIT License.
#
# Build the three parity Word_Lists deterministically:
#
#   - db-forms          1,200 sampled stem surfaces, each bare and in up to
#                       three affixed forms chosen through the AB/BC/AC
#                       compatibility tables, plus a normalization variant per
#                       form where applicable. Derived from the database, so
#                       CC BY 4.0 (NOTICE row "db-forms"). Requires a loaded
#                       MorphologyDB; built at generate.py time.
#   - edge-cases        the invented edge inventory. Built WITHOUT the
#                       database, so it can be written any time. Invented,
#                       no third-party source (NOTICE row "edge-cases").
#   - backoff-nonwords  200 seeded strings over AR_LETTERS_CHARSET, filtered
#                       to those absent from the stem table so they exercise
#                       the backoff path. Candidate generation is deterministic
#                       and db-free; the final stem-absence filter needs the
#                       loaded db, so it runs at generate.py time. Invented,
#                       no third-party source (NOTICE row "backoff-nonwords").
#
# It also builds the two Request_Lists that drive the generator and
# reinflector fixtures:
#
#   - gen-requests        300 seeded lemmas of the database's lemma table with
#                         up to nine feature requests each, one seeded clitic
#                         request each, and an invented block of edge
#                         requests. Derived from the database, so CC BY 4.0
#                         (NOTICE row "gen-requests"). Needs a MorphologyDB
#                         loaded with generation ('r').
#   - reinflect-requests  400 seeded db-forms words × ten feature bundles, the
#                         edge-cases words × three, and invented error
#                         bundles (NOTICE row "reinflect-requests").
#
# Each Request_List is written to fixtures/wordlists/<name>.requests.jsonl: a
# '#' header line with the seed and the builder, then one JSON object per line
# ({"lemma"|"word": ..., "feats": {...}}), checked by scan_text.py.
#
# Each list is written to fixtures/wordlists/<name>.words.txt, one word per
# line, with the seed recorded in a comment line at the head of the file. The
# file is a plain-text list a human reviews and tools/parity/scan_text.py
# guards (no spaces, no line over 32 code points, no stray line terminator)
# before it is committed.
#
# New-design file: project header only, no ported-code notice.
#
# This module imports no heavy or database-bound symbol at module scope, so it
# can be syntax-checked and its edge-cases path exercised without the database.
# The db-bound builders take an already-loaded MorphologyDB and are called by
# generate.py.

from __future__ import annotations

import json
import random
from pathlib import Path
from typing import TYPE_CHECKING, Iterable, List, Sequence

if TYPE_CHECKING:  # pragma: no cover - typing only, never imported at runtime
    # camel_tools is only present in the parity venv; keep it out of the
    # import graph for a bare syntax check.
    from camel_tools.morphology.database import MorphologyDB

# ---------------------------------------------------------------------------
# Seeds and sizes. Fixed here so every run reproduces the same lists; the seed
# of each list is also written into that list's file header.
# ---------------------------------------------------------------------------

DB_FORMS_SEED = 20261008
DB_FORMS_STEM_COUNT = 1200
DB_FORMS_MAX_AFFIXED = 3  # up to three affixed forms per sampled stem

BACKOFF_NONWORDS_SEED = 20261009
BACKOFF_NONWORDS_COUNT = 200
BACKOFF_NONWORDS_MIN_LEN = 2
BACKOFF_NONWORDS_MAX_LEN = 7

MAX_LINE_CODE_POINTS = 32  # the scan_text.py limit; builders stay well under it

# Resolve fixtures/wordlists/ relative to the repository root (this file is
# tools/parity/wordlists.py, so the root is two parents up).
REPO_ROOT = Path(__file__).resolve().parents[2]
WORDLISTS_DIR = REPO_ROOT / "fixtures" / "wordlists"


# ---------------------------------------------------------------------------
# Arabic character inventory used by the invented and candidate builders. These
# mirror src/engine/charsets.ts (AR_LETTERS_CHARSET and AR_DIAC_CHARSET) code
# point for code point; the port is the authority, this is a local copy for the
# db-free paths so wordlists.py needs no engine import.
# ---------------------------------------------------------------------------

AR_LETTERS = (
    "\u0621\u0622\u0623\u0624\u0625\u0626\u0627"
    "\u0628\u0629\u062a\u062b\u062c\u062d\u062e"
    "\u062f\u0630\u0631\u0632\u0633\u0634\u0635"
    "\u0636\u0637\u0638\u0639\u063a\u0640\u0641"
    "\u0642\u0643\u0644\u0645\u0646\u0647\u0648"
    "\u0649\u064a\u0671\u067e\u0686\u06a4\u06af"
)
AR_DIAC = "\u064b\u064c\u064d\u064e\u064f\u0650\u0651\u0652\u0670"

# The tatweel is a letter in AR_LETTERS but it is a connector, not a base to
# invent non-words from; drop it from the backoff candidate alphabet so a
# non-word is a run of real letters.
_TATWEEL = "\u0640"
BACKOFF_ALPHABET = [c for c in AR_LETTERS if c != _TATWEEL]


# ---------------------------------------------------------------------------
# Normalization variants: swap alef forms, ى/ي and ة/ه to provoke the
# analyzer's spvar path. A variant is produced only when the form actually
# contains one of these code points, so "a normalization variant per form
# where applicable".
# ---------------------------------------------------------------------------

_ALEF_FORMS = "\u0622\u0623\u0625\u0671"  # آ أ إ ٱ  → bare alef ا
_BARE_ALEF = "\u0627"
_ALEF_MAKSURA = "\u0649"  # ى
_YAA = "\u064a"  # ي
_TEH_MARBUTA = "\u0629"  # ة
_HEH = "\u0647"  # ه


def normalization_variant(form: str) -> str | None:
    """Return a normalized spelling of ``form`` that swaps alef, yaa and teh
    marbuta variants, or ``None`` when ``form`` holds none of them (so there is
    no distinct variant to emit)."""
    out_chars: List[str] = []
    changed = False
    for ch in form:
        if ch in _ALEF_FORMS:
            out_chars.append(_BARE_ALEF)
            changed = True
        elif ch == _ALEF_MAKSURA:
            out_chars.append(_YAA)
            changed = True
        elif ch == _TEH_MARBUTA:
            out_chars.append(_HEH)
            changed = True
        else:
            out_chars.append(ch)
    if not changed:
        return None
    return "".join(out_chars)


# ---------------------------------------------------------------------------
# edge-cases: the invented inventory. Built WITHOUT the database.
# ---------------------------------------------------------------------------

# A short, known Arabic word built only from AR_LETTERS, used where the
# inventory needs "an Arabic word" around which to place punctuation, tatweel,
# ZWNJ or an emoji. It is invented (a letter run), not running text.
_AR_WORD = "\u0643\u062a\u0627\u0628"  # k-t-a-b, an invented letter run

_ZWNJ = "\u200c"
_TATWEEL_CH = "\u0640"


def _edge_case_words() -> List[str]:
    """The invented edge inventory. Every entry is a digit, a symbol run, an
    invented letter run, a single code point, or empty — never copyrighted
    running text. One word per entry; none contains a space (scan_text.py
    forbids it) so the whitespace cases are single whitespace code points
    standing alone, which the Generator also surrounds with a word in the
    fixture matrix."""
    words: List[str] = []

    # Digits in three scripts: ASCII, Arabic-Indic, Extended Arabic-Indic.
    words.append("12345")  # ASCII
    words.append("\u0661\u0662\u0663\u0664\u0665")  # Arabic-Indic ١٢٣٤٥
    words.append("\u06f1\u06f2\u06f3\u06f4\u06f5")  # Extended Arabic-Indic ۱۲۳۴۵

    # Alphanumeric mix.
    words.append("a1")

    # Punctuation runs and Arabic with attached punctuation.
    words.append("!!!")
    words.append("?!.")
    words.append(_AR_WORD + ".")
    words.append("(" + _AR_WORD + ")")
    words.append("\u060c")  # Arabic comma ،
    words.append(_AR_WORD + "\u061f")  # Arabic question mark ؟ attached

    # Tatweel inside and around a word.
    words.append(_AR_WORD[:2] + _TATWEEL_CH + _AR_WORD[2:])  # inside
    words.append(_TATWEEL_CH + _AR_WORD)  # leading
    words.append(_AR_WORD + _TATWEEL_CH)  # trailing

    # Isolated diacritics (no base letter).
    words.append("\u064e")  # fatha alone
    words.append("\u064b\u0651")  # fathatan + shadda alone

    # Empty string and single whitespace code points standing alone.
    words.append("")  # empty
    words.append("\u0020")  # space (as a lone word; the only form scan allows)
    # NOTE: a lone U+0020 is a one-code-point line with no interior space, so
    # scan_text.py's "space inside a word" rule does not trip; the Generator
    # also pairs whitespace with a word through its own matrix. Non-space
    # whitespace code points stand alone safely:
    words.append("\u00a0")  # no-break space
    words.append("\u3000")  # ideographic space

    # Hamza and wasla forms.
    words.append("\u0621")  # hamza ء
    words.append("\u0623")  # alef with hamza above أ
    words.append("\u0625")  # alef with hamza below إ
    words.append("\u0624")  # waw with hamza ؤ
    words.append("\u0626")  # yeh with hamza ئ
    words.append("\u0671")  # alef wasla ٱ

    # Persian letters (in AR_LETTERS but Perso-Arabic).
    words.append("\u067e\u0686\u06a4\u06af")  # پچڤگ

    # Other scripts: Latin, Cyrillic, CJK.
    words.append("hello")
    words.append("\u043f\u0440\u0438\u0432\u0435\u0442")  # привет
    words.append("\u4f60\u597d")  # 你好

    # A URL-like token (no space; invented host).
    words.append("http://example.test/a")

    # The NOAN placeholder the backoff substitutes into.
    words.append("NOAN")

    # ZWNJ inside Arabic.
    words.append(_AR_WORD[:2] + _ZWNJ + _AR_WORD[2:])

    # An emoji attached to Arabic.
    words.append(_AR_WORD + "\U0001f600")  # grinning face

    # A supplementary-plane character alone.
    words.append("\U0001f600")  # grinning face alone
    words.append("\U00010000")  # Linear B syllable B008 A (a lone astral letter)

    return words


def build_edge_cases() -> List[str]:
    """Return the edge-cases Word_List. Deterministic and database-free; the
    order is the fixed inventory order above."""
    return _edge_case_words()


# ---------------------------------------------------------------------------
# backoff-nonwords candidates: 200 seeded strings over AR_LETTERS_CHARSET.
# Candidate generation is deterministic and database-free. The stem-absence
# filter needs the database and runs in build_backoff_nonwords (generate time).
# ---------------------------------------------------------------------------

def _backoff_candidates(seed: int, count: int, over: int) -> List[str]:
    """Generate ``over`` candidate non-word surfaces deterministically from
    ``seed`` so that, after dropping any that happen to be real stems, at least
    ``count`` remain. Each is a letter run of length 2..7 over
    BACKOFF_ALPHABET, with and without an affix-like edge (a leading or
    trailing single letter), de-duplicated preserving first-seen order."""
    rng = random.Random(seed)
    seen: dict[str, None] = {}
    # Generate generously; the caller filters against the stem table and then
    # takes the first ``count``.
    attempts = 0
    max_attempts = over * 20
    while len(seen) < over and attempts < max_attempts:
        attempts += 1
        length = rng.randint(BACKOFF_NONWORDS_MIN_LEN, BACKOFF_NONWORDS_MAX_LEN)
        body = "".join(rng.choice(BACKOFF_ALPHABET) for _ in range(length))
        # Alternate plain / affix-like edges to cover words with and without
        # affix-like edges.
        edge = rng.randint(0, 2)
        if edge == 1:
            word = rng.choice(BACKOFF_ALPHABET) + body  # leading affix-like
        elif edge == 2:
            word = body + rng.choice(BACKOFF_ALPHABET)  # trailing affix-like
        else:
            word = body
        if word not in seen:
            seen[word] = None
    return list(seen.keys())


def build_backoff_nonwords(db: "MorphologyDB") -> List[str]:
    """Return the backoff-nonwords Word_List: 200 seeded strings over the
    Arabic letters that are absent from the database's stem table (so each
    exercises the backoff path). Deterministic in ``BACKOFF_NONWORDS_SEED``;
    the only database use is the membership test.

    ``db`` is a loaded CAMeL Tools ``MorphologyDB``; its ``stem_hash`` maps a
    surface to its stem entries. A candidate counts as a non-word when it is
    not a key there."""
    stem_surfaces = _stem_surface_set(db)
    candidates = _backoff_candidates(
        BACKOFF_NONWORDS_SEED,
        BACKOFF_NONWORDS_COUNT,
        over=BACKOFF_NONWORDS_COUNT * 3,
    )
    nonwords = [w for w in candidates if w not in stem_surfaces]
    if len(nonwords) < BACKOFF_NONWORDS_COUNT:
        raise RuntimeError(
            "backoff-nonwords: too few non-words after filtering against the "
            f"stem table ({len(nonwords)} of {BACKOFF_NONWORDS_COUNT} needed); "
            "widen the candidate pool."
        )
    return nonwords[:BACKOFF_NONWORDS_COUNT]


# ---------------------------------------------------------------------------
# db-forms: 1,200 sampled stem surfaces, affixed through AB/BC/AC, with
# normalization variants. Requires a loaded database; built at generate time.
# ---------------------------------------------------------------------------

def _stem_surface_set(db: "MorphologyDB") -> set:
    """The set of stem surfaces in the database. ``MorphologyDB.stem_hash`` is a
    dict keyed by surface in CAMeL Tools 1.6.0."""
    return set(db.stem_hash.keys())


def _affixed_forms(
    db: "MorphologyDB",
    stem_surface: str,
    stem_entries: Sequence,
    rng: random.Random,
    want: int,
) -> List[str]:
    """Up to ``want`` affixed surfaces for one stem, each chosen through the
    AB, BC and AC compatibility tables: a prefix surface whose category is
    AB-compatible with the stem's category, a suffix surface whose category is
    BC-compatible with the stem's, and the prefix/suffix pair AC-compatible.
    Returns ``prefix_surface + stem_surface + suffix_surface`` strings, deduped,
    skipping any that would exceed the scan length limit."""
    forms: List[str] = []
    seen: set = set()
    # CAMeL Tools 1.6.0 MorphologyDB fields: prefix_hash / suffix_hash map a
    # surface to a list of (category, feats); prefix_cat_hash etc. hold the
    # compatibility sets. We read the compatibility tables defensively through
    # whatever the loaded db exposes.
    prefix_items = list(db.prefix_hash.items())
    suffix_items = list(db.suffix_hash.items())

    ab = db.prefix_stem_compat  # AB: prefix cat -> set of stem cats
    bc = db.stem_suffix_compat  # BC: stem cat -> set of suffix cats
    ac = db.prefix_suffix_compat  # AC: prefix cat -> set of suffix cats

    stem_cats = {e[0] for e in stem_entries}

    # Shuffle deterministically so the sample varies but reproduces.
    rng.shuffle(prefix_items)
    rng.shuffle(suffix_items)

    for pfx_surface, pfx_entries in prefix_items:
        if len(forms) >= want:
            break
        for pfx_cat, _pfx_feats in pfx_entries:
            # AB: this prefix category must admit one of the stem categories.
            if not (ab.get(pfx_cat, set()) & stem_cats):
                continue
            for sfx_surface, sfx_entries in suffix_items:
                if len(forms) >= want:
                    break
                for sfx_cat, _sfx_feats in sfx_entries:
                    # AC: prefix/suffix pair must be compatible.
                    if sfx_cat not in ac.get(pfx_cat, set()):
                        continue
                    # BC: the stem category must admit this suffix category.
                    stem_ok = any(
                        sfx_cat in bc.get(sc, set()) for sc in stem_cats
                    )
                    if not stem_ok:
                        continue
                    form = pfx_surface + stem_surface + sfx_surface
                    if form in seen:
                        continue
                    if _code_point_len(form) > MAX_LINE_CODE_POINTS:
                        continue
                    if " " in form:
                        continue
                    seen.add(form)
                    forms.append(form)
                    if len(forms) >= want:
                        break
    return forms


def build_db_forms(db: "MorphologyDB") -> List[str]:
    """Return the db-forms Word_List: a seeded sample of ``DB_FORMS_STEM_COUNT``
    stem surfaces, each as the bare stem and in up to ``DB_FORMS_MAX_AFFIXED``
    affixed forms chosen through AB/BC/AC, plus one normalization variant per
    form where applicable. Deterministic in ``DB_FORMS_SEED``. Derived from the
    database (CC BY 4.0; NOTICE row "db-forms")."""
    rng = random.Random(DB_FORMS_SEED)
    all_surfaces = sorted(db.stem_hash.keys())  # sort for a stable sample base
    if len(all_surfaces) <= DB_FORMS_STEM_COUNT:
        sampled = all_surfaces
    else:
        sampled = rng.sample(all_surfaces, DB_FORMS_STEM_COUNT)

    words: List[str] = []
    seen: set = set()

    def _add(word: str) -> None:
        if not word or word in seen:
            return
        if _code_point_len(word) > MAX_LINE_CODE_POINTS:
            return
        if " " in word:
            return
        seen.add(word)
        words.append(word)

    for surface in sampled:
        stem_entries = db.stem_hash[surface]
        forms = [surface]
        forms.extend(
            _affixed_forms(db, surface, stem_entries, rng, DB_FORMS_MAX_AFFIXED)
        )
        for form in forms:
            _add(form)
            variant = normalization_variant(form)
            if variant is not None:
                _add(variant)

    return words


# ---------------------------------------------------------------------------
# Shared helpers and file writing.
# ---------------------------------------------------------------------------

def _code_point_len(s: str) -> int:
    """Length in Unicode code points (Python strings are already code-point
    sequences, so ``len`` is correct here)."""
    return len(s)


def write_wordlist(name: str, seed: int | None, words: Iterable[str]) -> Path:
    """Write ``words`` to fixtures/wordlists/<name>.words.txt, one per line,
    with a header comment recording the list name and the seed it was built
    from. The header lines begin with ``#`` so they are metadata, not words;
    the Generator and scan_text.py skip ``#`` lines. Returns the path.

    An empty-string word is written as an empty line; a trailing newline ends
    the file. The caller is responsible for having run the words through the
    same deterministic builder."""
    WORDLISTS_DIR.mkdir(parents=True, exist_ok=True)
    path = WORDLISTS_DIR / f"{name}.words.txt"
    lines: List[str] = []
    lines.append(f"# shanisarf parity Word_List: {name}")
    if seed is not None:
        lines.append(f"# seed: {seed}")
    else:
        lines.append("# seed: n/a (fixed invented inventory, no randomness)")
    lines.append("# one word per line; '#' lines are metadata; see NOTICE")
    for word in words:
        lines.append(word)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return path


# The seeds, keyed by list name, so generate.py and scan report them uniformly.
LIST_SEEDS = {
    "db-forms": DB_FORMS_SEED,
    "edge-cases": None,
    "backoff-nonwords": BACKOFF_NONWORDS_SEED,
}


def write_edge_cases() -> Path:
    """Build and write edge-cases now (no database needed)."""
    return write_wordlist("edge-cases", LIST_SEEDS["edge-cases"], build_edge_cases())


def write_all(db: "MorphologyDB") -> List[Path]:
    """Build and write all three lists from a loaded database (generate time)."""
    return [
        write_wordlist("db-forms", LIST_SEEDS["db-forms"], build_db_forms(db)),
        write_edge_cases(),
        write_wordlist(
            "backoff-nonwords",
            LIST_SEEDS["backoff-nonwords"],
            build_backoff_nonwords(db),
        ),
    ]


# ---------------------------------------------------------------------------
# Request_Lists.
# ---------------------------------------------------------------------------

GEN_REQUESTS_SEED = 20261010
GEN_REQUESTS_LEMMA_COUNT = 300
REINFLECT_REQUESTS_SEED = 20261011
REINFLECT_REQUESTS_WORD_COUNT = 400

# The features of which a gen-requests lemma gets one request each, with a
# seeded value of the feature's define, when its pos's DEFAULTS row has it.
GEN_FEATURE_KEYS = ["per", "gen", "num", "asp", "stt", "cas", "mod"]
# The clitic features a seeded clitic request draws from.
GEN_CLITIC_KEYS = ["prc0", "prc1", "prc2", "prc3", "enc0"]

# An invented lemma absent from the database (checked at build time).
_UNKNOWN_LEMMA = "\u0632\u0632\u0632\u0632\u0632"  # a run of zain, not a word
# An invented feature name no ALMOR database defines (checked at build time).
_UNDEFINED_FEATURE = "xyz"
# An invented value outside every closed define (checked at build time).
_INVALID_VALUE = "invalid"

# The ten bundles measured over the Database_Pin, the three the edge-cases
# words get, and the invented error bundles.
REINFLECT_BUNDLES = [
    {"num": "p"},
    {"gen": "f"},
    {"per": "1"},
    {"asp": "i"},
    {"stt": "d"},
    {"cas": "a"},
    {"enc0": "3ms_poss"},
    {"prc0": "Al_det"},
    {"num": "ANY"},
    {"rat": "y"},
]
REINFLECT_EDGE_BUNDLES = [{"num": "p"}, {"prc0": "Al_det"}, {"num": "ANY"}]
REINFLECT_ERROR_BUNDLES = [
    {_UNDEFINED_FEATURE: "1"},  # an undefined feature
    {"num": _INVALID_VALUE},  # a value outside the define
    {"rat": "ANY"},  # ANY on a feature outside ANY_FEATS
]


def _closed_values(db: "MorphologyDB", feat: str) -> List[str]:
    """A closed define's values, sorted (upstream keeps them in a set, whose
    order depends on the hash seed)."""
    values = db.defines.get(feat)
    return sorted(values) if values is not None else []


def _key_outside_row(db: "MorphologyDB", pos: str) -> tuple | None:
    """The first defined feature (sorted) that the pos's DEFAULTS row lacks,
    with a value that passes validation, or None when the row has them all."""
    row = db.defaults[pos]
    for feat in sorted(db.defines):
        if feat in row:
            continue
        values = _closed_values(db, feat)
        if db.defines[feat] is None:
            return feat, "x"
        if values:
            return feat, values[0]
    return None


def build_gen_requests(db: "MorphologyDB") -> List[dict]:
    """Return the gen-requests Request_List: for each of 300 seeded lemmas,
    ``{pos}`` (the first stem's pos); ``{pos, vox, rat}`` with the keys the
    first stem has; ``pos`` plus a seeded value of each GEN_FEATURE_KEYS
    feature the pos's DEFAULTS row has; and one seeded clitic request. Then
    the invented edge requests. Deterministic in GEN_REQUESTS_SEED. ``db``
    must be loaded with generation."""
    rng = random.Random(GEN_REQUESTS_SEED)
    lemmas = sorted(
        lemma
        for lemma in db.lemma_hash
        if lemma != "NOAN" and 0 < len(lemma) <= MAX_LINE_CODE_POINTS and " " not in lemma
    )
    sampled = rng.sample(lemmas, GEN_REQUESTS_LEMMA_COUNT)

    requests: List[dict] = []

    def _add(lemma: str, feats: dict) -> None:
        requests.append({"lemma": lemma, "feats": feats})

    for lemma in sampled:
        first = db.lemma_hash[lemma][0]
        pos = first["pos"]
        row = db.defaults.get(pos, {})
        _add(lemma, {"pos": pos})
        vox_rat = {"pos": pos}
        for feat in ("vox", "rat"):
            if feat in first:
                vox_rat[feat] = first[feat]
        _add(lemma, vox_rat)
        for feat in GEN_FEATURE_KEYS:
            values = _closed_values(db, feat)
            if feat in row and values:
                _add(lemma, {"pos": pos, feat: rng.choice(values)})
        clitics = [k for k in GEN_CLITIC_KEYS if k in row and _closed_values(db, k)]
        if clitics:
            feat = rng.choice(clitics)
            _add(lemma, {"pos": pos, feat: rng.choice(_closed_values(db, feat))})

    # The invented edge requests.
    if _UNKNOWN_LEMMA in db.lemma_hash or _UNDEFINED_FEATURE in db.defines:
        raise RuntimeError("gen-requests: an invented edge value is in the database")
    lemma0, lemma1 = sampled[0], sampled[1]
    pos0 = db.lemma_hash[lemma0][0]["pos"]
    pos1 = db.lemma_hash[lemma1][0]["pos"]
    _add(_UNKNOWN_LEMMA, {_UNDEFINED_FEATURE: "1"})  # unknown lemma, invalid feature
    _add(lemma0 + "_1", {"pos": pos0})  # lemma suffixes
    _add(lemma0 + "-u", {"pos": pos0})
    _add(lemma1, {"pos": pos1, _UNDEFINED_FEATURE: "1"})  # undefined feature
    _add(lemma1, {"pos": pos1, "num": _INVALID_VALUE})  # invalid value
    _add(lemma1, {"num": _closed_values(db, "num")[0]})  # missing pos
    _add(lemma1, {"pos": _INVALID_VALUE})  # undefined pos
    # A key outside the DEFAULTS row. Measured over the Database_Pin: every
    # DEFAULTS row carries all 53 defined features, so there is none and this
    # request is not emitted; the generator unit and property tests cover that
    # branch instead.
    outside = _key_outside_row(db, pos1)
    if outside is not None:
        _add(lemma1, {"pos": pos1, outside[0]: outside[1]})
    _add("NOAN", {"pos": db.lemma_hash["NOAN"][0]["pos"]})
    return requests


def build_reinflect_requests(
    db_forms_words: Sequence[str], edge_words: Sequence[str]
) -> List[dict]:
    """Return the reinflect-requests Request_List: 400 seeded db-forms words,
    each with the ten REINFLECT_BUNDLES; every edge-cases word with the three
    REINFLECT_EDGE_BUNDLES; and the invented error bundles on three db-forms
    words and one edge-cases word. Deterministic in REINFLECT_REQUESTS_SEED."""
    rng = random.Random(REINFLECT_REQUESTS_SEED)
    words = rng.sample(list(db_forms_words), REINFLECT_REQUESTS_WORD_COUNT)
    requests: List[dict] = []
    for word in words:
        for bundle in REINFLECT_BUNDLES:
            requests.append({"word": word, "feats": dict(bundle)})
    for word in edge_words:
        for bundle in REINFLECT_EDGE_BUNDLES:
            requests.append({"word": word, "feats": dict(bundle)})
    for word in list(words[:3]) + [edge_words[0]]:
        for bundle in REINFLECT_ERROR_BUNDLES:
            requests.append({"word": word, "feats": dict(bundle)})
    return requests


def write_request_list(name: str, seed: int, requests: Iterable[dict]) -> Path:
    """Write ``requests`` to fixtures/wordlists/<name>.requests.jsonl: a '#'
    header line with the name, seed and builder, then one compact JSON object
    per line with the lemma or word first. Returns the path."""
    WORDLISTS_DIR.mkdir(parents=True, exist_ok=True)
    path = WORDLISTS_DIR / f"{name}.requests.jsonl"
    lines = [f"# {name} seed={seed} builder=tools/parity/wordlists.py"]
    for request in requests:
        lines.append(json.dumps(request, ensure_ascii=False, separators=(",", ":")))
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return path


def read_request_list(name: str) -> List[dict]:
    """Read a Request_List back: skip the '#' header, parse each line."""
    path = WORDLISTS_DIR / f"{name}.requests.jsonl"
    out: List[dict] = []
    for line in path.read_text(encoding="utf-8").split("\n"):
        if line == "" or line.startswith("#"):
            continue
        out.append(json.loads(line))
    return out


def write_request_lists(
    db: "MorphologyDB", db_forms_words: Sequence[str], edge_words: Sequence[str]
) -> List[Path]:
    """Build and write both Request_Lists (generate time; ``db`` loaded 'r')."""
    return [
        write_request_list("gen-requests", GEN_REQUESTS_SEED, build_gen_requests(db)),
        write_request_list(
            "reinflect-requests",
            REINFLECT_REQUESTS_SEED,
            build_reinflect_requests(db_forms_words, edge_words),
        ),
    ]


if __name__ == "__main__":
    # Run bare, this writes only the database-free list (edge-cases); the other
    # two are written by generate.py once the Database_Pin is loaded.
    out = write_edge_cases()
    print(f"Wrote {out} ({len(build_edge_cases())} words)")
