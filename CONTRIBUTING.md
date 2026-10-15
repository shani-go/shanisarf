# Contributing to shanisarf

The rules a change must keep, and the tools that check them. The design is
in [`docs/design.md`](docs/design.md); the principles are in
[`VISION.md`](VISION.md).

## Layout

- `src/engine/` the analyzer, the database model and parser, the generator
  and reinflector, character maps, tokenizer, lexicon: the port of CAMeL
  Tools plus the tuple model behind it.
- `src/load/` the asset loader (`loadDatabase`, `readAsset`, `openAsset`),
  browser and Node variants. `src/compile/` the ALMOR-to-asset compiler
  (`shanisarf/compile`, Node only). `src/worker/` the `shanisarf/worker`
  subpath. `src/align/` the alignment functions. `src/msa-features.ts` the
  generated typed-features module.
- `tests/parity/` replays the fixtures; `tests/property/` the fast-check
  properties; `tests/support/` shared helpers. Unit tests sit beside their
  modules.
- `tools/parity/` the only Python: a pinned CAMeL Tools venv that fetches
  the database and generates fixtures. `tools/gen-charmaps.ts` generates
  `src/engine/charmaps/` from the upstream JSON.
- `fixtures/wordlists/` the committed word and request lists;
  `fixtures/meta/` the canonical-key vector and the Python whitespace set.
  `fixtures/parity/` and `data/` are git-ignored: generated fixtures,
  downloaded databases, compiled assets.
- `packages/shanisarf-db-msa/` the data package: its `source.json`,
  `NOTICE`, README and the committed expected `asset-digest.json`; its
  `asset/` is built by `npm run compile:db` and git-ignored.
- `demo/` the static demo page, served by `npm run demo`.
- Stack: TypeScript, ESM and CJS builds, Vitest, fast-check, zero runtime
  dependencies, Node 20 or later and evergreen browsers.

## Hard invariants

These hold on every commit.

1. **License range.** Code (`src/`, `tools/`, tests, anything published as
   code) is MIT only. Committed or packaged data and text are public domain,
   CC0 or CC BY. CC BY-SA material may be consulted and cited and may drive a
   local test from the git-ignored `data/`, but nothing derived from it is
   committed or packaged. Nothing under GPL, LGPL, AGPL, MPL, LDC,
   non-commercial, research-only or unknown terms is committed, bundled or
   distributed: not in the repository, a published package or a comment
   "for reference". That includes CAMeL Tools' own `camel_data` databases
   and its MLE disambiguator model, which also never drive a test or a
   fixture. Development tools that run only on a developer's machine (npm
   devDependencies, the parity venv) are outside the range when nothing of
   theirs is committed, bundled or distributed; the release runbooks list
   their licenses. A value upstream derived from restricted data and
   published under an in-range license is in range on the licensor's
   statement; `NOTICE` records the case (the Camel Morph scores).
2. **No copyrighted running text,** not a line, in any file. Test words come
   from the database, from a word list recorded in `NOTICE`, or are
   invented.
3. **No network at analysis time.** The library requests nothing but what
   the caller's `loadDatabase(source)` names. `npm run check:invariants`
   greps for network APIs under `src/`.
4. **Parity before change.** The engine returns what CAMeL Tools returns
   over the same database. An output-changing improvement is a default-off
   option until the fixtures say otherwise. A change under `src/engine/` is
   not done until the parity fixtures pass unchanged.
5. **Attribution travels.** Every third-party input has a `NOTICE` row
   before it lands; compiled assets carry license and attribution in their
   manifest.
6. **Respect upstream.** No "CAMeL" or "CALIMA" in the project's or the
   packages' names. If CAMeL Lab asks for the repository or the packages to
   be unpublished, they are.
7. **Automation is local and report-only.** Checks report; they never edit
   files. No cloud routines or GitHub automation.

## Bringing in a third-party input

Before any code, data, word list, model or text touches the repository, the
build, the tests or a demo (a development tool that is never committed,
bundled or distributed is not an input; see invariant 1):

1. Identify the license from the source's own LICENSE file or data-license
   statement, not from a package index or a badge. Record where you read it.
2. Check the range above. Refuse out-of-range material and propose an
   in-range alternative.
3. Running text that is a creative work is out regardless of license. Word
   lists and lexicons within the range are fine.
4. Add the `NOTICE` row first: source URL, license, copyright holder, what
   shanisarf takes, the obligation, the attribution text, and the citation
   the authors ask for. Copy the upstream LICENSE verbatim into
   `licenses/<UPSTREAM>_LICENSE`.
5. Never commit a raw download; `tools/` fetches it into `data/` and
   verifies a recorded hash.
6. A compiled asset's manifest carries `license`, `credits` (with the
   "adapted" note), `source`, `sourceSha256` and `disclaimer`. Nothing may
   imply that CAMeL Lab endorses shanisarf.

## The ported-code notice

The engine is a transformation of CAMeL Tools (MIT, Copyright 2018-2026 New
York University Abu Dhabi), and the MIT License requires the upstream notice
to travel with substantial portions of the software. Every file that is a
line-for-line port of, or structurally similar to, an upstream file carries
this as its first comment, before any import:

```ts
// Ported from CAMeL Tools <upstream path> (version <X.Y.Z>).
// Copyright 2018-2026 New York University Abu Dhabi. MIT License.
// The upstream license is reproduced in licenses/CAMEL_TOOLS_LICENSE; see NOTICE.
// shanisarf's changes are Copyright <year> shani-go (https://github.com/shani-go), MIT License.
```

Structurally similar means the same function or class decomposition, the
same algorithm with the same control flow, constants or regular expressions
translated, or a data table copied or derived from upstream. Renaming,
changing the language or splitting a module does not make a file original.
When in doubt, add it. Files that are new design carry the project header
only; the module map in `docs/design.md` says which is which, and the
`NEW_DESIGN_BASENAMES` list in `scripts/check-invariants.mjs` is the
check's authority. Bumping the pinned upstream version updates the version
in every notice (`grep -rl 'Ported from CAMeL Tools' src tools`).

## Parity fixtures and property tests

1. Fixtures are generated by `tools/parity/` from the pinned CAMeL Tools and
   the pinned database. Never hand-edit one; change the generator or the
   word list and regenerate (`npm run parity:setup`, then
   `npm run parity:generate`). They are git-ignored.
2. Analyses are canonically sorted on both sides and compared as sorted
   lists, duplicates counted, with exact equality of every value.
3. A parity failure is a bug in the port until proven otherwise. Do not fix
   the fixture.
4. Word lists come only from forms built from the database, a list with a
   `NOTICE` row, or invented edge cases. Scan a new list with
   `tools/parity/scan_text.py` (the invariants check runs it).
5. One property per test, named for the invariant it checks. Arbitraries
   draw Arabic from the database's own character sets and include the
   normalization variants deliberately. Set `numRuns` and timeouts per
   property. A property must fail on a deliberately broken engine at least
   once before it is committed.

## Working on the code

```bash
npm install            # builds (prepare)
npm run typecheck && npm run lint && npm test
npm run check:invariants
npm run parity:setup   # fetch the pinned database and build the parity venv (developer only)
npm run parity:generate && npm test   # regenerate the fixtures and replay them
npm run compile:db     # compile the data package's asset; --verify checks the committed digest
npm run parity:asset   # replay every fixture over the compiled asset
npm run measure:db     # table counts, parse time and memory (needs the database)
npm run bench          # the port against CAMeL Tools on the same words (needs the venv)
npm run check:consumer # install the package by tarball, git URL and path into scratch consumers
npm run demo           # the demo page on one origin (build and compile:db first)
```

Tests that need the database or the fixtures skip with a notice when
`data/` or `fixtures/parity/` is absent, so a clean clone runs the unit
tests and the data-free properties only. The full suite is the acceptance
test.

Runbooks for the rarer tasks live in `docs/`: `upstream-sync.md` (a newer
CAMeL Tools release), `npm-first-publish.md` and `npm-release.md`.
