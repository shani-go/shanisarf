#!/usr/bin/env python3
# shanisarf parity harness. Copyright 2026 shani-go (https://github.com/shani-go), MIT License.
#
# Fetch the Database_Pin: the Camel Morph MSA v1.0 database from the
# camel_morph repository, pinned to one commit and verified by SHA-256.
#
# This is the only network call in the repository, and it is invoked by the
# developer, never by the library (invariant: no network at analysis time;
# see CONTRIBUTING.md). The database is CC BY 4.0
# (see NOTICE, "Camel Morph MSA v1.0"); the raw file is never committed, so it
# lands in the git-ignored data/ directory.
#
# Usage:
#     python tools/parity/fetch_db.py
#
# On a SHA-256 mismatch the partial download is deleted and the script exits
# non-zero.

import hashlib
import sys
from pathlib import Path

import requests

# The Database_Pin: commit, upstream path and SHA-256 are fixed here and must
# match packages/shanisarf-db-msa/source.json and the Camel Morph row in
# NOTICE. Bumping the database updates all three in one change.
REPO = "CAMeL-Lab/camel_morph"
COMMIT = "15f5aede4b609db54abd6f87aded1f5ec5d930af"
UPSTREAM_PATH = (
    "official_releases/lrec-coling2024_release/databases/"
    "camel-morph-msa/camel_morph_msa_v1.0.db"
)
EXPECTED_SHA256 = (
    "110e03baa282874062d076e23d9671e985b6f76520b891d58cba4e55de0b8f60"
)

RAW_URL = f"https://raw.githubusercontent.com/{REPO}/{COMMIT}/{UPSTREAM_PATH}"

# Resolve data/camel-morph-msa/msa-v1.0.db relative to the repository root
# (this file is tools/parity/fetch_db.py, so the root is two parents up).
REPO_ROOT = Path(__file__).resolve().parents[2]
DEST = REPO_ROOT / "data" / "camel-morph-msa" / "msa-v1.0.db"

# Hash in fixed-size chunks so a large file never loads whole into memory.
_CHUNK = 1 << 20  # 1 MiB


def _sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(_CHUNK), b""):
            digest.update(block)
    return digest.hexdigest()


def fetch_db() -> Path:
    """Download the Database_Pin to DEST and verify its SHA-256.

    Returns the destination path on success. Deletes the file and raises
    SystemExit on a hash mismatch; raises requests.HTTPError on a failed
    download.
    """
    DEST.parent.mkdir(parents=True, exist_ok=True)

    print(f"Fetching Database_Pin from {RAW_URL}")
    with requests.get(RAW_URL, stream=True, timeout=120) as response:
        response.raise_for_status()
        with DEST.open("wb") as handle:
            for chunk in response.iter_content(chunk_size=_CHUNK):
                if chunk:
                    handle.write(chunk)

    actual = _sha256_of(DEST)
    if actual != EXPECTED_SHA256:
        DEST.unlink(missing_ok=True)
        raise SystemExit(
            "SHA-256 mismatch for the Database_Pin; deleted the partial file.\n"
            f"  expected {EXPECTED_SHA256}\n"
            f"  got      {actual}"
        )

    print(f"Verified Database_Pin at {DEST} (SHA-256 {actual})")
    return DEST


if __name__ == "__main__":
    try:
        fetch_db()
    except SystemExit as exc:
        print(exc, file=sys.stderr)
        raise
