#!/usr/bin/env python3
# shanisarf parity harness. Copyright 2026 shani-go (https://github.com/shani-go), MIT License.
#
# The committed-text guard for the parity Word_Lists. A Word_List is one word
# per line; this script refuses a list that contains:
#
#   - a line with a space inside a word (a committed word has no interior
#     space; a line "a b" would be two words and a smuggling vector for
#     running text),
#   - a line longer than 32 code points (a parity probe is a short surface,
#     not a sentence),
#   - a line with a line terminator inside a word (a stray CR, LS, PS or other
#     Unicode line break hiding inside what should be a single-line word).
#
# Metadata lines (those beginning with '#', the header the wordlists.py writer
# emits) are skipped: they carry the list name and seed, not words.
#
# A Request_List (`<name>.requests.jsonl`) is checked line by line too. Each
# non-'#' line must be one JSON object with exactly the keys `lemma` (or
# `word`) and `feats`, `feats` an object of strings, and every string in it
# (the lemma or word, each feature name and each value) must pass the word
# rules above.
#
# It is the report-only check scripts/check-invariants.mjs runs over every
# Word_List, and generate.py runs before it emits fixtures (the Generator
# refuses to run when a Word_List fails the scan). It edits nothing. Run as a
# CLI; it exits non-zero on the first violating file.
#
# New-design file: project header only, no ported-code notice.
#
# Usage:
#     python tools/parity/scan_text.py fixtures/wordlists/*.words.txt \
#         fixtures/wordlists/*.requests.jsonl

from __future__ import annotations

import json

import sys
from pathlib import Path
from typing import List, NamedTuple

MAX_LINE_CODE_POINTS = 32

# A metadata line is a comment; it is not a word and is not scanned as one.
COMMENT_PREFIX = "#"

# ASCII space; the rule forbids any space *inside a word*. A line that is a
# single space is a lone whitespace word (an intentional edge-cases entry) and
# has no interior space, so it is allowed; a line like "a b" has an interior
# space and is refused.
SPACE = "\u0020"

# Unicode line/paragraph terminators that, if they appear inside a line's text
# (after the file is split on the usual newline boundaries), indicate a stray
# terminator smuggled inside a word. We split the raw bytes on '\n' only, then
# look for any of these surviving inside a line. '\r' is included so a lone CR
# (old-Mac newline) inside a word is caught; the trailing '\r' of a CRLF pair
# is stripped before the check so a normal CRLF file does not false-positive.
LINE_TERMINATORS = (
    "\r",        # CR
    "\x0b",      # vertical tab (Python str.splitlines treats as a break)
    "\x0c",      # form feed
    "\x1c",      # file separator
    "\x1d",      # group separator
    "\x1e",      # record separator
    "\x85",      # next line (NEL)
    "\u2028",    # line separator
    "\u2029",    # paragraph separator
)


class Violation(NamedTuple):
    path: Path
    line_number: int  # 1-based, counting every physical line including comments
    kind: str
    detail: str


def _scan_line(path: Path, line_number: int, raw_line: str) -> List[Violation]:
    """Return the violations in one physical line. ``raw_line`` is the line
    with its trailing '\\n' already removed by the caller; a trailing '\\r'
    (the CR of a CRLF pair) is stripped here so a normal CRLF file is clean,
    but any *interior* CR or other terminator still trips the check."""
    violations: List[Violation] = []

    # Strip a single trailing CR (CRLF line ending). An interior CR survives.
    line = raw_line[:-1] if raw_line.endswith("\r") else raw_line

    # Metadata/header lines are not words.
    if line.startswith(COMMENT_PREFIX):
        return violations

    # A space inside the word. A line that is exactly one space is a lone
    # whitespace word and is allowed; a space with other content around it is
    # an interior space and refused.
    if SPACE in line and line != SPACE:
        col = line.index(SPACE)
        violations.append(
            Violation(
                path,
                line_number,
                "space-in-word",
                f"space at code point {col}",
            )
        )

    # Longer than 32 code points. Python strings count code points directly.
    if len(line) > MAX_LINE_CODE_POINTS:
        violations.append(
            Violation(
                path,
                line_number,
                "too-long",
                f"{len(line)} code points (limit {MAX_LINE_CODE_POINTS})",
            )
        )

    # A line terminator surviving inside the word.
    for term in LINE_TERMINATORS:
        if term in line:
            col = line.index(term)
            violations.append(
                Violation(
                    path,
                    line_number,
                    "terminator-in-word",
                    f"terminator U+{ord(term):04X} at code point {col}",
                )
            )
            break

    return violations


def _scan_request_line(path: Path, line_number: int, raw_line: str) -> List[Violation]:
    """Return the violations in one Request_List line: the JSON shape, then
    the word rules over every string the object holds."""
    line = raw_line[:-1] if raw_line.endswith("\r") else raw_line
    if line.startswith(COMMENT_PREFIX):
        return []
    try:
        obj = json.loads(line)
    except ValueError as exc:
        return [Violation(path, line_number, "bad-json", str(exc))]
    if not isinstance(obj, dict) or set(obj) not in ({"lemma", "feats"}, {"word", "feats"}):
        keys = sorted(obj) if isinstance(obj, dict) else type(obj).__name__
        return [Violation(path, line_number, "bad-shape", f"keys {keys}; expected lemma or word, and feats")]
    head = obj.get("lemma", obj.get("word"))
    feats = obj["feats"]
    if not isinstance(head, str) or not isinstance(feats, dict) or not all(
        isinstance(k, str) and isinstance(v, str) for k, v in feats.items()
    ):
        return [Violation(path, line_number, "bad-shape", "lemma/word and feats must hold strings only")]
    violations: List[Violation] = []
    for value in [head, *feats.keys(), *feats.values()]:
        for v in _scan_line(path, line_number, value):
            violations.append(v._replace(detail=f"{v.detail} in {json.dumps(value, ensure_ascii=False)}"))
    return violations


def scan_text(path: Path) -> List[Violation]:
    """Scan one Word_List file and return every violation. Reads the file as
    UTF-8, splits on '\\n' only (so an embedded CR/LS/PS is seen as interior,
    not as a line boundary), and checks each physical line. Returns an empty
    list for a clean file."""
    # Read with newline translation DISABLED (newline="") so an interior CR,
    # NEL, LS or PS is preserved verbatim rather than being normalized to '\n'
    # by Python's universal-newline handling; otherwise a stray terminator
    # inside a word would silently become a line boundary and escape the scan.
    with path.open("r", encoding="utf-8", newline="") as handle:
        text = handle.read()
    # Split on '\n' only. A real newline ends a line; everything else that
    # Python would treat as a break (CR, NEL, LS, PS, VT, FF, FS, GS, RS) is
    # left inside the line so the terminator-in-word rule can catch it.
    raw_lines = text.split("\n")
    # text.split('\n') on a file ending in '\n' yields a trailing '' segment;
    # drop that final empty segment (it is the end of file, not a word line).
    if raw_lines and raw_lines[-1] == "":
        raw_lines = raw_lines[:-1]

    scan_line = _scan_request_line if path.name.endswith(".requests.jsonl") else _scan_line
    violations: List[Violation] = []
    for index, raw_line in enumerate(raw_lines):
        violations.extend(scan_line(path, index + 1, raw_line))
    return violations


def scan_files(paths: List[Path]) -> List[Violation]:
    """Scan several Word_List files, returning all violations across them."""
    all_violations: List[Violation] = []
    for path in paths:
        all_violations.extend(scan_text(path))
    return all_violations


def _format(violation: Violation) -> str:
    return (
        f"{violation.path}:{violation.line_number}: "
        f"{violation.kind}: {violation.detail}"
    )


def main(argv: List[str]) -> int:
    if not argv:
        print(
            "usage: python tools/parity/scan_text.py <name.words.txt | name.requests.jsonl> ...",
            file=sys.stderr,
        )
        return 2

    paths = [Path(a) for a in argv]
    missing = [p for p in paths if not p.is_file()]
    if missing:
        for p in missing:
            print(f"scan_text: no such file: {p}", file=sys.stderr)
        return 2

    violations = scan_files(paths)
    if violations:
        print("scan_text: Word_List violations found:", file=sys.stderr)
        for v in violations:
            print("  " + _format(v), file=sys.stderr)
        return 1

    for p in paths:
        print(f"scan_text: OK {p}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
