# Upstream sync runbook

Bringing the port up to a newer CAMeL Tools release. Run top to bottom;
every step ends in a check. `OLD` is the pin in
`tools/parity/requirements.txt`, `NEW` the target release, `$SCRATCH` a
directory outside the repository. Work on a branch and commit locally. At
any ⛔, stop, leave the branch as it is, and report.

```bash
OLD=$(sed -n 's/^camel-tools==//p' tools/parity/requirements.txt)
NEW=$(curl -s https://pypi.org/pypi/camel-tools/json | python3 -I -c 'import json,sys; print(json.load(sys.stdin)["info"]["version"])')
```

## 0. Preconditions and baseline

- `git status --porcelain` is empty; `git switch -c upstream/camel-tools-$NEW`.
- `NEW` differs from `OLD`.
- The venv holds `OLD` and the database is present (`npm run parity:setup`
  if not).
- The baseline is green: `npm run typecheck && npm run lint && npm run build && npm test && npm run check:invariants`.
  Build before testing: the worker tests run `dist/`.
- Baseline fixtures from `OLD`: `npm run parity:generate`, then
  `cp -R fixtures/parity "$SCRATCH/fixtures-$OLD"`. The fixtures are
  git-ignored, so this copy is the only record of upstream's output at
  `OLD`. Keep the same Python interpreter throughout so the later diff is
  upstream's alone.

## 1. Fetch both releases outside the repository

Downloads are untrusted: each goes in its own empty directory, nothing in
them is executed, and any Python that reads them runs with `-I`.

```bash
for v in "$OLD" "$NEW"; do
  mkdir -p "$SCRATCH/dl-$v" "$SCRATCH/src-$v"
  tools/parity/.venv/bin/python -m pip download --no-deps --only-binary :all: -d "$SCRATCH/dl-$v" "camel-tools==$v"
  unzip -q "$SCRATCH/dl-$v"/camel_tools-*.whl -d "$SCRATCH/src-$v"
done
```

## 2. License gate (⛔ before any port work)

- `grep -x 'License: MIT' "$SCRATCH/src-$NEW"/camel_tools-*.dist-info/METADATA`, else ⛔.
- `diff "$SCRATCH/src-$NEW"/camel_tools-*.dist-info/licenses/LICENSE licenses/CAMEL_TOOLS_LICENSE`.
  Empty: go on. Only the years differ: copy the new file verbatim and carry
  the new range into every per-file notice, `NOTICE`, `README.md` and
  `CONTRIBUTING.md`. Anything else: ⛔.
- Diff the import lines of the in-scope files between `OLD` and `NEW`. A
  new third-party module must be MIT, BSD or Apache-2.0 and is added to
  `requirements.txt` with its license comment. If the analysis path now
  needs `camel_tools.data`, a model, `camel-kenlm` or a built-in database:
  ⛔ (`tools/parity/smoke_import.py` is the proof it does not).

## 3. Isolate the in-scope diff

In scope is exactly the upstream set the module map in `design.md` names:

```
camel_tools/morphology/{analyzer,database,errors,generator,reinflector,utils}.py
camel_tools/utils/{charmap,charsets,dediac,normalize,transliterate,stringutils}.py
camel_tools/utils/charmaps/*_map.json
camel_tools/tokenizers/word.py
```

`diff -ru` over those paths only into `$SCRATCH/inscope.diff`; list every
other changed path as out of scope and read nothing more from it. Write a
ledger with one row per hunk: upstream file and function; kind (`behavior`:
control flow, regex, constant, data table, error text, signature; `text`:
comments, docstrings, formatting; `unported`: a member the port omits, such
as `builtin_db` or the CLI); the engine file; the decision. An empty
in-scope diff skips to step 5.

## 4. Port the `behavior` hunks

Follow the port rules in `design.md`: code points, the `python-compat.ts`
helpers, each regex translated one by one with the `u` flag, errors where
upstream raises. Where a hunk lands:

| Upstream | Engine |
|---|---|
| `morphology/utils.py` `merge_features` | `tuple-merge.ts`: the merge plan and its steps |
| `morphology/utils.py` constants, rewrite rules, `strip_lex`, `simple_ar_to_caphi` | `features.ts` |
| `morphology/database.py` parsing | `almor-parser.ts` and its builders (`string-table.ts`, `feature-schema.ts`, `compat-bitset.ts`) |
| `morphology/database.py` model and tables | `database.ts`, `model-views.ts`; a change of shape also reaches `almor-serializer.ts` and `model-codec.ts` |
| `morphology/analyzer.py` | `analyzer.ts`, `segments.ts`, `tuple-merge.ts` |
| `morphology/generator.py`, `reinflector.py` | `generator.ts`, `reinflector.ts` |
| `morphology/errors.py`, `utils/*.py`, `tokenizers/word.py` | the module named for it |

- The engine is restructured, so a hunk is usually not a transliteration: a
  new merge step is a new merge-plan entry and a step in the tuple merge,
  and it must keep upstream's key order, which
  `src/engine/result-key-order.test.ts` pins.
- Charmap JSON changed: copy `camel_tools/utils/charmaps/*_map.json` to
  `data/camel-tools-charmaps/`, set `UPSTREAM_VERSION` in
  `tools/gen-charmaps.ts`, run it. Never hand-edit `src/engine/charmaps/`.
- A new in-scope module or a split: a new file named for what it does, the
  ported-code notice as its first comment, a row in the module map, and its
  path in the `NOTICE` "What shanisarf takes" list.
- Port what upstream does and nothing more. An improvement is a default-off
  option, never a silent deviation.
- Each changed regex or constant gets a unit test beside its module.
- A change of the model's shape also changes the asset's format: bump the
  format version in `model-codec.ts` and the loader, and recompile the data
  package.

## 5. Bump the pin everywhere

```bash
grep -rn "$OLD" --exclude-dir=node_modules --exclude-dir=.venv --exclude-dir=dist --exclude-dir=__pycache__ . | grep -v package-lock
```

`tools/parity/requirements.txt`, the install line in `scripts/parity.mjs`,
`EXPECTED_VERSION` in `tools/parity/smoke_import.py`,
`EXPECTED_CAMEL_TOOLS_VERSION` in `tools/parity/generate.py`,
`UPSTREAM_VERSION` in `tools/gen-charmaps.ts`, every ported-code notice
(`grep -rl 'Ported from CAMeL Tools' src tools`, then regenerate the
charmaps), `NOTICE`, `README.md` and `docs/design.md`. Check:
`grep -rn 'Ported from CAMeL Tools' src tools | grep -v -e "version $NEW" -e '^tools/gen-charmaps.ts:'`
prints nothing.

## 6. Regenerate and replay parity

```bash
tools/parity/.venv/bin/python -m pip install --no-deps "camel-tools==$NEW"
tools/parity/.venv/bin/python -m pip install -r tools/parity/requirements.txt
tools/parity/.venv/bin/python tools/parity/smoke_import.py
npm run parity:generate -- --check && npm run parity:generate
```

- A refusal (version, SHA-256, `scan_text`, the size budget) is fixed at its
  cause, never by editing a guard. The generator succeeding is the no-fork
  check: `NEW` loads the pinned database unmodified. If it cannot: ⛔.
- Diff each fixture against `$SCRATCH/fixtures-$OLD/` (gunzip, drop
  `generatedAt` and `reference`). Every changed case must trace to a
  `behavior` ledger row; one that does not means the ledger missed a hunk.
- `git status --porcelain fixtures/wordlists fixtures/meta` is empty.
- `npm run build && npm test && npm run parity:asset`. A parity failure is
  a port bug: fix the engine, never a fixture or the generator.
- `npm run typecheck && npm run lint && npm run measure:db && npm run check:invariants`.
- `npm run gen:features` reproduces `src/msa-features.ts` byte for byte
  (the database is unchanged by a sync).
- `npm run bench`, and compare with the README's table.

## 7. Document and report

`NOTICE` (the CAMeL Tools row), `README.md`, `docs/design.md` where
behaviour changed. Commit on the branch as `sync port to CAMeL Tools NEW`,
the body the ledger summary and the fixture diff counts. Report `OLD` to
`NEW`, in-scope files changed, ledger rows by kind, fixture cases changed
per fixture, the test output, out-of-scope upstream changes, and any ⛔.

## Stop conditions (⛔)

The license is not MIT, or the LICENSE changed beyond its years. A new
in-scope dependency outside MIT, BSD or Apache-2.0. The analysis path needs
`camel_data`, a model, `camel-kenlm` or a built-in database. The database no
longer loads unmodified on `NEW`. An in-scope hunk cannot be ported within
the port rules or the license range. A parity failure that does not trace
to a port defect.
