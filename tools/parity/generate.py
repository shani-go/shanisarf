#!/usr/bin/env python3
# shanisarf parity harness. Copyright 2026 shani-go (https://github.com/shani-go), MIT License.
#
# The parity fixture Generator. It runs CAMeL Tools 1.6.0 over the
# Database_Pin and the three committed Word_Lists and writes the golden
# fixtures the TypeScript Replay suite (tests/parity/) checks the port
# against.
#
# What it produces, under fixtures/:
#
#   parity/<list>.<backoff>[.strict].json.gz   one gzipped fixture per matrix
#                                              cell:
#                                                db-forms          × NONE
#                                                edge-cases        × 5 modes
#                                                                  × strict off/on
#                                                backoff-nonwords  × 5 modes
#   parity/word-tokenizer.json.gz              the edge-cases words and a set of
#                                              invented multi-word strings,
#                                              tokenized with and without
#                                              split_digits
#   parity/generation/generator.gen-requests.json.gz
#   parity/generation/reinflector.reinflect-requests.json.gz
#                                              CAMeL Tools' Generator and
#                                              Reinflector over a second, 'r'
#                                              load of the Database_Pin and the
#                                              two Request_Lists, with the
#                                              Defined_Twin's output where
#                                              CAMeL Tools raises KeyError
#   meta/python-whitespace.json                the str.isspace() code points and
#                                              seeded strip/split samples
#   meta/canonical-vector.json                 left in place: it is a committed
#                                              meta fixture of invented analyses
#                                              (not CAMeL Tools output), so the
#                                              Generator does not overwrite it;
#                                              it only verifies it is present
#                                              and that canonical.py agrees with
#                                              it, so the two Canonical_Key
#                                              halves stay pinned.
#
# Each fixture carries a header: schema, generatedAt, the CAMeL Tools
# versions, the Database_Pin identity, the analyzer config, the word list and
# its NOTICE reference, and a knownDrift list. Cases hold each word's analyses
# in Canonical_Order (canonical.py).
#
# Guards: the Generator refuses to run when camel_tools.__version__ is not the
# pin, when the Database_Pin's SHA-256 does not match, or when any Word_List
# fails scan_text.py. It also fails above the 25 MB fixtures/parity/ budget,
# naming the largest files, and prints the Unicode_Drift count.
#
# New-design file: project header only, no ported-code notice. It imports only
# camel_tools.morphology / .utils / .tokenizers and never a data-fetch entry
# point (smoke_import.py proves the footprint).
#
# Usage:
#     python tools/parity/generate.py            # write all fixtures
#     python tools/parity/generate.py --check    # run the guards only, write
#                                                 # nothing (a smoke run)
#     python tools/parity/generate.py --generation-only
#                                                 # leave the analyzer and
#                                                 # tokenizer fixtures unwritten;
#                                                 # write only generation/

from __future__ import annotations

import argparse
import datetime
import gc
import gzip
import hashlib
import json
import subprocess
import sys
import unicodedata
from pathlib import Path
from typing import Dict, List, Optional, Tuple

# The harness modules live beside this file; import them by their module names
# so the script runs from the repository root (python tools/parity/generate.py)
# with tools/parity on sys.path.
sys.path.insert(0, str(Path(__file__).resolve().parent))

import canonical  # noqa: E402  (shared Canonical_Key)
import scan_text  # noqa: E402  (the committed-text guard)
import wordlists  # noqa: E402  (the three Word_List builders)
from fetch_db import DEST as DB_PATH  # noqa: E402  (data/.../msa-v1.0.db)
from fetch_db import EXPECTED_SHA256  # noqa: E402  (the Database_Pin SHA-256)

# ---------------------------------------------------------------------------
# Pins and paths. The CAMeL Tools version, the fixture schema, the matrix and
# the budget are fixed here; the database identity comes from fetch_db.py so
# the two never drift.
# ---------------------------------------------------------------------------

EXPECTED_CAMEL_TOOLS_VERSION = "1.6.0"
FIXTURE_SCHEMA = "shanisarf-parity/1"

# The five backoff modes (upstream _BACKOFF_TYPES).
BACKOFF_MODES = ["NONE", "NOAN_ALL", "NOAN_PROP", "ADD_ALL", "ADD_PROP"]

# The 25 MB budget for the committed-shape fixtures/parity/ tree. The fixtures
# are git-ignored (CC BY database output), but the budget still gates
# generation so a configuration never explodes the matrix.
PARITY_BUDGET_BYTES = 25 * 1024 * 1024

# The database identity written into every fixture header. commit/path come
# from fetch_db.py's pin; name/version are the Database_Pin's label.
from fetch_db import COMMIT as DB_COMMIT  # noqa: E402
from fetch_db import UPSTREAM_PATH as DB_UPSTREAM_PATH  # noqa: E402

DB_NAME = "camel-morph-msa"
DB_VERSION = "1.0"

# Resolve the repository tree relative to this file (tools/parity/generate.py,
# so the root is two parents up).
REPO_ROOT = Path(__file__).resolve().parents[2]
FIXTURES_DIR = REPO_ROOT / "fixtures"
PARITY_DIR = FIXTURES_DIR / "parity"
GENERATION_DIR = PARITY_DIR / "generation"
META_DIR = FIXTURES_DIR / "meta"
WORDLISTS_DIR = FIXTURES_DIR / "wordlists"
HOST_CLASSIFY = Path(__file__).resolve().parent / "host_classify.mjs"

# The NOTICE reference recorded in each fixture's wordList header, keyed by
# the Word_List name. db-forms is derived from the CC BY 4.0 database; the
# other two are invented.
WORDLIST_NOTICE = {
    "db-forms": "derived from the Camel Morph MSA database (CC BY 4.0); see NOTICE",
    "edge-cases": "invented; no third-party source; see NOTICE",
    "backoff-nonwords": "invented; no third-party source; see NOTICE",
}

# The NOTICE reference recorded in each generation fixture's requestList
# header.
REQUEST_LIST_NOTICE = {
    "gen-requests": "derived from the Camel Morph MSA database (CC BY 4.0) plus invented edge requests; see NOTICE",
    "reinflect-requests": "db-forms (CC BY 4.0) and edge-cases words with invented bundles; see NOTICE",
}

# The six generation-side error classes a generation fixture records as an
# `error` case. Any other exception but the KeyError CAMeL Tools raises for a
# stem missing vox, rat or pos stops the run.
GENERATION_ERRORS = frozenset([
    "GeneratorError",
    "InvalidGeneratorFeature",
    "InvalidGeneratorFeatureValue",
    "ReinflectorError",
    "InvalidReinflectorFeature",
    "InvalidReinflectorFeatureValue",
])

# The matrix. Each entry is (list name, backoff mode, strictDigit or None).
# strictDigit is a dimension only for edge-cases, where digit words live;
# db-forms and backoff-nonwords carry no digits so the dimension would
# duplicate fixtures. db-forms runs only under NONE (its forms are real words;
# the backoff modes are exercised by the other two lists).
def _matrix() -> List[Tuple[str, str, Optional[bool]]]:
    cells: List[Tuple[str, str, Optional[bool]]] = []
    cells.append(("db-forms", "NONE", None))
    for backoff in BACKOFF_MODES:
        for strict in (False, True):
            cells.append(("edge-cases", backoff, strict))
    for backoff in BACKOFF_MODES:
        cells.append(("backoff-nonwords", backoff, None))
    return cells


# ---------------------------------------------------------------------------
# Guards. Each raises SystemExit with a one-line reason.
# ---------------------------------------------------------------------------

def _check_reference_version() -> str:
    import camel_tools

    version = getattr(camel_tools, "__version__", None)
    if version != EXPECTED_CAMEL_TOOLS_VERSION:
        raise SystemExit(
            "generate: camel_tools.__version__ is %r, expected %r; rebuild the "
            "venv from tools/parity/requirements.txt (npm run parity:setup)"
            % (version, EXPECTED_CAMEL_TOOLS_VERSION)
        )
    return version


def _sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def _check_database() -> str:
    if not DB_PATH.is_file():
        raise SystemExit(
            "generate: the Database_Pin is not at %s; fetch it with "
            "`npm run parity:setup` (tools/parity/fetch_db.py)" % DB_PATH
        )
    actual = _sha256_of(DB_PATH)
    if actual != EXPECTED_SHA256:
        raise SystemExit(
            "generate: Database_Pin SHA-256 mismatch; refusing to generate.\n"
            "  expected %s\n  got      %s" % (EXPECTED_SHA256, actual)
        )
    return actual


def _check_wordlists_scan(paths: List[Path]) -> None:
    """Run scan_text.py over every Word_List; refuse to run on any violation.
    scan_text reports, it does not edit."""
    violations = scan_text.scan_files(paths)
    if violations:
        lines = "\n".join("  " + scan_text._format(v) for v in violations)
        raise SystemExit(
            "generate: a Word_List failed the committed-text scan; refusing to "
            "generate (fix the generator or the list, never a fixture):\n" + lines
        )


def _check_canonical_vector() -> None:
    """Verify the committed canonical vector is present and that canonical.py
    reproduces every expected Canonical_Key, so the two Canonical_Key halves
    stay pinned. The Generator does not rewrite this file (it holds invented
    analyses, not CAMeL Tools output); it only checks it."""
    vector_path = META_DIR / "canonical-vector.json"
    if not vector_path.is_file():
        raise SystemExit(
            "generate: %s is missing; it is a committed meta fixture"
            % vector_path
        )
    data = json.loads(vector_path.read_text(encoding="utf-8"))
    for vec in data.get("vectors", []):
        got = canonical.canonical_key(vec["analysis"])
        if got != vec["canonicalKey"]:
            raise SystemExit(
                "generate: canonical.py disagrees with the committed vector "
                "%r:\n  expected %r\n  got      %r"
                % (vec.get("name"), vec["canonicalKey"], got)
            )


# ---------------------------------------------------------------------------
# CAMeL Tools-side and host-side classification. The CAMeL Tools branch comes
# from CAMeL Tools' own predicates, so it is exactly what CAMeL Tools does.
# The host branch comes from host_classify.mjs run under Node, so it is
# exactly what the JavaScript host does. A word whose two branches differ is
# Unicode_Drift.
# ---------------------------------------------------------------------------

def _reference_branch(word: str, strict_digit: bool) -> str:
    """The analyzer branch CAMeL Tools takes for ``word`` (digit, punc,
    haspunc, foreign, lexical, or empty), using CAMeL Tools' own `_is_*`
    predicates on the stripped word, in CAMeL Tools' branch order."""
    from camel_tools.morphology import analyzer as ref

    stripped = word.strip()
    if stripped == "":
        return "empty"
    if (strict_digit and ref._is_strict_digit(stripped)) or (
        not strict_digit and ref._is_digit(stripped)
    ):
        return "digit"
    if ref._is_punc(stripped):
        return "punc"
    if ref._has_punc(stripped):
        return "haspunc"
    if not ref._is_ar(stripped):
        return "foreign"
    return "lexical"


def _host_branches(words: List[str], strict_digit: bool) -> List[str]:
    """Classify ``words`` under the JavaScript host by spawning
    host_classify.mjs once. Returns one branch label per word, in order."""
    args = ["node", str(HOST_CLASSIFY)]
    if strict_digit:
        args.append("--strict")
    proc = subprocess.run(
        args,
        input=json.dumps(words),
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    if proc.returncode != 0:
        raise SystemExit(
            "generate: host_classify.mjs failed (is Node installed?):\n"
            + proc.stderr
        )
    labels = json.loads(proc.stdout)
    if len(labels) != len(words):
        raise SystemExit(
            "generate: host_classify.mjs returned %d labels for %d words"
            % (len(labels), len(words))
        )
    return labels


def _known_drift(
    words: List[str], strict_digit: bool, host_unicode: str
) -> List[Dict[str, str]]:
    """The knownDrift entries for a Word_List under one strictDigit setting:
    the words whose host branch differs from CAMeL Tools', each with both
    classifications and the host's Unicode version."""
    host = _host_branches(words, strict_digit)
    drift: List[Dict[str, str]] = []
    for word, host_branch in zip(words, host):
        ref_branch = _reference_branch(word, strict_digit)
        if ref_branch != host_branch:
            drift.append(
                {
                    "word": word,
                    "reference": ref_branch,
                    "host": host_branch,
                    "hostUnicode": host_unicode,
                }
            )
    return drift


# ---------------------------------------------------------------------------
# The host's Unicode version (ICU), read once through Node so the fixture
# header records the version drift is measured against.
# ---------------------------------------------------------------------------

def _host_unicode_version() -> str:
    proc = subprocess.run(
        ["node", "-e", "process.stdout.write(process.versions.unicode || 'unknown')"],
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    if proc.returncode != 0:
        return "unknown"
    return proc.stdout.strip() or "unknown"


# ---------------------------------------------------------------------------
# Fixture assembly.
# ---------------------------------------------------------------------------

def _analyzer_header(backoff: str, strict_digit: Optional[bool]) -> Dict[str, object]:
    header: Dict[str, object] = {"backoff": backoff, "normMap": "default"}
    # strictDigit is recorded whenever the dimension applies to the list; for
    # the lists without digits it is omitted (the analyzer default is false and
    # the Replay reads it as false when absent).
    if strict_digit is not None:
        header["strictDigit"] = strict_digit
    else:
        header["strictDigit"] = False
    return header


def _case(analyzer, word: str) -> Dict[str, object]:
    """One case: the word and its analyses in Canonical_Order.
    CAMeL Tools' analyses are plain dicts of str / float / None."""
    analyses = analyzer.analyze(word)
    ordered = canonical.canonical_order(list(analyses))
    return {"word": word, "analyses": ordered}


def _build_fixture(
    analyzer,
    list_name: str,
    words: List[str],
    backoff: str,
    strict_digit: Optional[bool],
    reference_versions: Dict[str, str],
    database_identity: Dict[str, str],
    host_unicode: str,
    generated_at: str,
) -> Dict[str, object]:
    strict_for_drift = bool(strict_digit)
    return {
        "schema": FIXTURE_SCHEMA,
        "generatedAt": generated_at,
        "reference": reference_versions,
        "database": database_identity,
        "analyzer": _analyzer_header(backoff, strict_digit),
        "wordList": {
            "name": list_name,
            "notice": WORDLIST_NOTICE[list_name],
        },
        "knownDrift": _known_drift(words, strict_for_drift, host_unicode),
        "cases": [_case(analyzer, word) for word in words],
    }


def _fixture_filename(
    list_name: str, backoff: str, strict_digit: Optional[bool]
) -> str:
    name = f"{list_name}.{backoff}"
    if strict_digit:
        name += ".strict"
    return name + ".json.gz"


def _write_gzip_json(path: Path, data: Dict[str, object]) -> int:
    """Write ``data`` as compact UTF-8 JSON, gzipped, and return the byte size
    of the written file. Keys are not re-sorted here: the analyses are already
    in Canonical_Order and their keys are canonicalized inside each
    Canonical_Key; the fixture object's own key order is the insertion order
    above, which the Replay reads by name."""
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    # mtime=0 so regenerating identical content yields an identical file (the
    # gzip header otherwise embeds the current time).
    with gzip.GzipFile(filename="", mode="wb", fileobj=path.open("wb"), mtime=0) as gz:
        gz.write(payload.encode("utf-8"))
    return path.stat().st_size


# ---------------------------------------------------------------------------
# The word-tokenizer fixture. The edge-cases words plus a set of invented
# multi-word strings, tokenized with and without split_digits.
# ---------------------------------------------------------------------------

# Invented short multi-word strings for the tokenizer: a letter run, digits and
# attached punctuation around whitespace. None is copyrighted running text;
# each is an invented probe of the whitespace split and the symbol pattern.
_TOKENIZER_MULTIWORD = [
    "\u0643\u062a\u0627\u0628 123",          # letters, space, ASCII digits
    "a1 b2 c3",                               # alnum runs
    "\u0643\u062a\u0627\u0628! \u0642\u0644\u0645?",  # attached punctuation
    "(\u0643\u062a\u0627\u0628)",            # bracketed letters
    "1,234.5",                                # digits with separators
    "\u0661\u0662\u0663 \u0664\u0665",        # Arabic-Indic digits around a space
    "\u0643\u062a\u0627\u0628\U0001f600 \U0001f600",  # emoji attached and alone
    "hello\u00a0world",                       # a no-break space between words
]


def _tokenizer_fixture(
    reference_versions: Dict[str, str],
    database_identity: Dict[str, str],
    generated_at: str,
) -> Dict[str, object]:
    from camel_tools.tokenizers.word import simple_word_tokenize

    inputs = list(wordlists.build_edge_cases()) + list(_TOKENIZER_MULTIWORD)
    cases = []
    for text in inputs:
        cases.append(
            {
                "input": text,
                "tokens": list(simple_word_tokenize(text)),
                "tokensSplitDigits": list(
                    simple_word_tokenize(text, split_digits=True)
                ),
            }
        )
    return {
        "schema": FIXTURE_SCHEMA,
        "generatedAt": generated_at,
        "reference": reference_versions,
        "database": database_identity,
        "note": (
            "simpleWordTokenize fixture. Emoji "
            "membership is approximated by the UTS #51 pattern; a "
            "token that depends on the emoji approximation is a documented "
            "divergence, not a parity failure. No input is copyrighted running "
            "text; each is an invented probe or an edge-cases word."
        ),
        "cases": cases,
    }


# ---------------------------------------------------------------------------
# The python-whitespace meta fixture.
# ---------------------------------------------------------------------------

def _python_whitespace_fixture() -> Dict[str, object]:
    """The code points for which Python's str.isspace() is true, plus seeded
    strip/split samples. The engine's PY_WHITESPACE is pinned to the
    `whitespace` list; src/engine/python-compat.test.ts reads it."""
    whitespace = [chr(cp) for cp in range(0x110000) if chr(cp).isspace()]
    # Seeded samples: Python's own strip/split over strings that interleave
    # whitespace and non-whitespace, so the TypeScript side can check pyStrip
    # and pySplit against Python's results. Deterministic, invented inputs.
    sample_inputs = [
        "  abc  ",
        "\t\n abc def \r\n",
        "abc",
        "   ",
        "",
        "a\u00a0b\u2003c",
        "\u3000word\u3000",
    ]
    samples = [
        {"input": s, "strip": s.strip(), "split": s.split()}
        for s in sample_inputs
    ]
    return {
        "schema": "shanisarf-python-whitespace/1",
        "note": (
            "The code points for which Python's str.isspace() is true "
            "and seeded "
            "strip/split samples. The engine's PY_WHITESPACE is pinned to the "
            "`whitespace` list; this file is generated, never hand-edited."
        ),
        "python": __import__("platform").python_version(),
        "whitespace": whitespace,
        "samples": samples,
    }


# ---------------------------------------------------------------------------
# The fixtures/parity/ size budget.
# ---------------------------------------------------------------------------

def _parity_sizes() -> Dict[str, int]:
    """The size of every fixture under fixtures/parity/, generation/ included
    keyed by its path relative to parity/."""
    return {
        str(path.relative_to(PARITY_DIR)): path.stat().st_size
        for path in sorted(PARITY_DIR.rglob("*.json.gz"))
    }


def _check_budget(sizes: Dict[str, int]) -> None:
    total = sum(sizes.values())
    if total > PARITY_BUDGET_BYTES:
        largest = sorted(sizes.items(), key=lambda kv: kv[1], reverse=True)[:5]
        lines = "\n".join(
            f"  {name}  {size / (1024 * 1024):.2f} MB" for name, size in largest
        )
        raise SystemExit(
            "generate: fixtures/parity/ is %.2f MB, over the %.0f MB budget "
            "Largest fixtures:\n%s"
            % (total / (1024 * 1024), PARITY_BUDGET_BYTES / (1024 * 1024), lines)
        )


# ---------------------------------------------------------------------------
# Load the word lists for the run: build them from the database and scan.
# ---------------------------------------------------------------------------

def _load_wordlist_words(name: str) -> List[str]:
    """Read a Word_List file's words (skipping the `#` metadata header lines),
    preserving order and keeping an empty-string word (a blank line) as ''."""
    path = WORDLISTS_DIR / f"{name}.words.txt"
    words: List[str] = []
    # Read with newline translation disabled so a stray terminator would be
    # caught by scan_text, not silently normalized; split on '\n' only.
    raw = path.read_text(encoding="utf-8")
    lines = raw.split("\n")
    if lines and lines[-1] == "":
        lines = lines[:-1]
    for line in lines:
        if line.startswith("#"):
            continue
        words.append(line)
    return words


# ---------------------------------------------------------------------------
# Generation fixtures.
# ---------------------------------------------------------------------------

class _Absent:
    """The Defined_Twin's answer for a missing vox, rat or pos: equal to
    nothing, so a stem lacking a requested key is skipped."""

    def __eq__(self, other: object) -> bool:
        return False

    def __ne__(self, other: object) -> bool:
        return True

    __hash__ = object.__hash__

    def __repr__(self) -> str:
        return "<absent>"


_ABSENT = _Absent()


class _TwinStem(dict):
    """A lemma-hash stem dictionary that answers a missing vox, rat or pos with
    _ABSENT where CAMeL Tools' dict raises KeyError; every other missing key
    still raises."""

    def __missing__(self, key: str):
        if key in ("vox", "rat", "pos"):
            return _ABSENT
        raise KeyError(key)


def _make_twin(db) -> None:
    """Turn a loaded 'r' MorphologyDB into the Defined_Twin in place: each
    lemma_hash stem dictionary is replaced by a _TwinStem copy. stem_hash keeps
    CAMeL Tools' own dictionaries, so the Reinflector's Analyzer is
    unchanged; only the Generator's stem lookups differ, and only where
    CAMeL Tools raises."""
    for lemma, stems in db.lemma_hash.items():
        db.lemma_hash[lemma] = [_TwinStem(stem) for stem in stems]


def _outcome(call) -> Dict[str, object]:
    """Run one request and describe its outcome: analyses in Canonical_Order,
    a generation-side error, or the KeyError for a missing vox, rat or pos.
    Anything else stops the run."""
    from camel_tools.morphology.errors import MorphologyError

    try:
        analyses = [dict(a) for a in call()]
    except MorphologyError as exc:
        name = type(exc).__name__
        if name not in GENERATION_ERRORS:
            raise SystemExit("generate: unexpected %s: %s" % (name, exc))
        return {"error": {"type": name, "message": str(exc)}}
    except KeyError as exc:
        return {"raises": "KeyError: %s" % exc}
    return {"analyses": canonical.canonical_order(analyses)}


def _generation_cases(db, component: str, requests: List[dict]) -> List[Dict[str, object]]:
    """Run ``requests`` through CAMeL Tools, then through the Defined_Twin
    (``db`` is turned into it in place), and assemble the fixture cases. The
    twin must equal CAMeL Tools on every case where CAMeL Tools did not
    raise; otherwise the run stops and nothing is written."""
    from camel_tools.morphology.generator import Generator
    from camel_tools.morphology.reinflector import Reinflector

    head = "lemma" if component == "generator" else "word"

    def _runner():
        engine = Generator(db) if component == "generator" else Reinflector(db)
        method = engine.generate if component == "generator" else engine.reinflect
        return lambda req: _outcome(lambda: method(req[head], dict(req["feats"])))

    run = _runner()
    reference = [run(req) for req in requests]
    _make_twin(db)
    run = _runner()
    twin = [run(req) for req in requests]

    cases: List[Dict[str, object]] = []
    mismatches = []
    for req, ref, tw in zip(requests, reference, twin):
        case: Dict[str, object] = {head: req[head], "feats": req["feats"]}
        if "raises" in ref:
            if "analyses" not in tw:
                raise SystemExit(
                    "generate: the Defined_Twin did not resolve %s on %r: %r"
                    % (ref["raises"], req, tw)
                )
            case["referenceRaises"] = ref["raises"]
            case["analyses"] = tw["analyses"]
        else:
            if tw != ref:
                mismatches.append(req)
            case.update(ref)
        cases.append(case)
    if mismatches:
        raise SystemExit(
            "generate: the Defined_Twin differs from CAMeL Tools on %d %s "
            "case(s) where CAMeL Tools did not raise; "
            "refusing to write. First: %r" % (len(mismatches), component, mismatches[0])
        )
    return cases


def _generation_fixture(
    component: str,
    list_name: str,
    cases: List[Dict[str, object]],
    reference_versions: Dict[str, str],
    database_identity: Dict[str, str],
    generated_at: str,
) -> Dict[str, object]:
    """The generation fixture: the analyzer fixture's header minus `analyzer`
    and `knownDrift`, plus `component` and the database flags."""
    return {
        "schema": FIXTURE_SCHEMA,
        "component": component,
        "generatedAt": generated_at,
        "reference": reference_versions,
        "database": {**database_identity, "flags": "r"},
        "requestList": {"name": list_name, "notice": REQUEST_LIST_NOTICE[list_name]},
        "cases": cases,
    }


def _write_generation_fixtures(
    reference_versions: Dict[str, str],
    database_identity: Dict[str, str],
    generated_at: str,
    check_only: bool,
) -> None:
    """Load the Database_Pin a second time with 'r', build and scan the two
    Request_Lists, and (unless ``check_only``) write the two generation
    fixtures. The Request_Lists are refused before any fixture is written."""
    from camel_tools.morphology.database import MorphologyDB

    print(f"generate: loading the Database_Pin with 'r' at {DB_PATH}")
    db = MorphologyDB(str(DB_PATH), "r")

    print("generate: building the Request_Lists")
    request_paths = wordlists.write_request_lists(
        db, _load_wordlist_words("db-forms"), _load_wordlist_words("edge-cases")
    )
    _check_wordlists_scan(request_paths)
    if check_only:
        return

    GENERATION_DIR.mkdir(parents=True, exist_ok=True)
    plan = [
        ("generator", "gen-requests"),
        ("reinflector", "reinflect-requests"),
    ]
    for component, list_name in plan:
        if component == "reinflector":
            # The generator pass turned ``db`` into the Defined_Twin; reload
            # so the reinflector's CAMeL Tools pass runs on the unmodified
            # database.
            del db
            gc.collect()
            db = MorphologyDB(str(DB_PATH), "r")
        requests = wordlists.read_request_list(list_name)
        cases = _generation_cases(db, component, requests)
        fixture = _generation_fixture(
            component, list_name, cases, reference_versions, database_identity, generated_at
        )
        filename = f"{component}.{list_name}.json.gz"
        size = _write_gzip_json(GENERATION_DIR / filename, fixture)
        print(
            "generate: wrote parity/generation/%s  (%d cases, %d analyses, "
            "%d errors, %d referenceRaises, %.1f KB)"
            % (
                filename,
                len(cases),
                sum(len(c.get("analyses", [])) for c in cases),
                sum(1 for c in cases if "error" in c),
                sum(1 for c in cases if "referenceRaises" in c),
                size / 1024,
            )
        )


# ---------------------------------------------------------------------------
# Main.
# ---------------------------------------------------------------------------

def generate(check_only: bool = False, generation_only: bool = False) -> int:
    # --- Guards ---
    camel_version = _check_reference_version()
    db_sha = _check_database()
    _check_canonical_vector()

    # Build the three Word_Lists from the loaded database (db-forms and
    # backoff-nonwords need it; edge-cases does not), then scan them before any
    # fixture is written.
    from camel_tools.morphology.database import MorphologyDB
    from camel_tools.morphology.analyzer import Analyzer

    print(f"generate: loading the Database_Pin at {DB_PATH}")
    db = MorphologyDB(str(DB_PATH), "a")

    print("generate: building the Word_Lists")
    wordlist_paths = wordlists.write_all(db)
    _check_wordlists_scan(wordlist_paths)

    # Versions for the fixture header and the host's Unicode version for drift.
    import platform

    reference_versions = {
        "camelTools": camel_version,
        "python": platform.python_version(),
        "unidata": unicodedata.unidata_version,
        "emoji": _emoji_version(),
    }
    database_identity = {
        "name": DB_NAME,
        "version": DB_VERSION,
        "commit": DB_COMMIT,
        "sha256": db_sha,
    }
    host_unicode = _host_unicode_version()
    generated_at = datetime.datetime.now(datetime.timezone.utc).strftime(
        "%Y-%m-%dT%H:%M:%SZ"
    )

    print(
        "generate: reference %s / python %s / unidata %s / emoji %s; host ICU %s"
        % (
            reference_versions["camelTools"],
            reference_versions["python"],
            reference_versions["unidata"],
            reference_versions["emoji"],
            host_unicode,
        )
    )

    if check_only:
        del db
        gc.collect()
        _write_generation_fixtures(
            reference_versions, database_identity, generated_at, check_only=True
        )
        print(
            "generate: --check passed (version, SHA-256, canonical-vector, "
            "Word_List and Request_List scans OK); rebuilt the lists but wrote "
            "no fixtures"
        )
        return 0

    if generation_only:
        del db
        gc.collect()
        _write_generation_fixtures(
            reference_versions, database_identity, generated_at, check_only=False
        )
        sizes = _parity_sizes()
        _check_budget(sizes)
        print(
            "generate: done (generation only). fixtures/parity/ holds %d "
            "fixtures, %.2f MB total (budget %.0f MB)."
            % (len(sizes), sum(sizes.values()) / (1024 * 1024), PARITY_BUDGET_BYTES / (1024 * 1024))
        )
        return 0

    # Read the words of each list back (what the fixtures iterate).
    words_by_list = {name: _load_wordlist_words(name) for name in WORDLIST_NOTICE}

    # Cache analyzers by backoff mode and strictDigit so each is built once.
    analyzers: Dict[Tuple[str, bool], object] = {}

    def _analyzer_for(backoff: str, strict_digit: bool):
        key = (backoff, strict_digit)
        if key not in analyzers:
            analyzers[key] = Analyzer(
                db, backoff=backoff, strict_digit=strict_digit
            )
        return analyzers[key]

    PARITY_DIR.mkdir(parents=True, exist_ok=True)
    META_DIR.mkdir(parents=True, exist_ok=True)

    sizes: Dict[str, int] = {}
    total_drift = 0
    distinct_drift_words: set = set()

    for list_name, backoff, strict in _matrix():
        words = words_by_list[list_name]
        analyzer = _analyzer_for(backoff, bool(strict))
        fixture = _build_fixture(
            analyzer,
            list_name,
            words,
            backoff,
            strict,
            reference_versions,
            database_identity,
            host_unicode,
            generated_at,
        )
        for drift in fixture["knownDrift"]:
            total_drift += 1
            distinct_drift_words.add(drift["word"])
        filename = _fixture_filename(list_name, backoff, strict)
        size = _write_gzip_json(PARITY_DIR / filename, fixture)
        sizes[filename] = size
        print(
            "generate: wrote parity/%s  (%d cases, %d drift, %.1f KB)"
            % (
                filename,
                len(fixture["cases"]),
                len(fixture["knownDrift"]),
                size / 1024,
            )
        )

    # The word-tokenizer fixture (counts against the parity budget).
    tok = _tokenizer_fixture(reference_versions, database_identity, generated_at)
    tok_size = _write_gzip_json(PARITY_DIR / "word-tokenizer.json.gz", tok)
    sizes["word-tokenizer.json.gz"] = tok_size
    print(
        "generate: wrote parity/word-tokenizer.json.gz  (%d cases, %.1f KB)"
        % (len(tok["cases"]), tok_size / 1024)
    )

    # The python-whitespace meta fixture (not under the parity budget).
    ws = _python_whitespace_fixture()
    (META_DIR / "python-whitespace.json").write_text(
        json.dumps(ws, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(
        "generate: wrote meta/python-whitespace.json  (%d whitespace code points)"
        % len(ws["whitespace"])
    )

    # The generation fixtures on a second, 'r' load; the 'a' model and its
    # analyzers are released first.
    analyzers.clear()
    del db
    gc.collect()
    _write_generation_fixtures(
        reference_versions, database_identity, generated_at, check_only=False
    )

    # Budget check over the whole tree, generation/ included.
    sizes = _parity_sizes()
    _check_budget(sizes)

    total_mb = sum(sizes.values()) / (1024 * 1024)
    print(
        "generate: done. %d parity fixtures, %.2f MB total (budget %.0f MB), "
        "%d drift entries (%d distinct words)."
        % (
            len(sizes),
            total_mb,
            PARITY_BUDGET_BYTES / (1024 * 1024),
            total_drift,
            len(distinct_drift_words),
        )
    )
    return 0


def _emoji_version() -> str:
    try:
        import emoji

        return getattr(emoji, "__version__", "unknown")
    except Exception:  # noqa: BLE001
        return "unknown"


def main(argv: List[str]) -> int:
    parser = argparse.ArgumentParser(
        description="Generate the shanisarf parity fixtures from CAMeL Tools."
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="run the guards only and write nothing (a smoke run)",
    )
    parser.add_argument(
        "--generation-only",
        action="store_true",
        help="write only the generation fixtures; leave the others as they are",
    )
    args = parser.parse_args(argv)
    try:
        return generate(check_only=args.check, generation_only=args.generation_only)
    except SystemExit as exc:
        # Surface the one-line reason on stderr and keep the non-zero status.
        if exc.code and not isinstance(exc.code, int):
            print(exc.code, file=sys.stderr)
            return 1
        raise


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
