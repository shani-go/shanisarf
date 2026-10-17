# npm release runbook (parity-preserving)

For an agent. Run top to bottom; every step ends in a check. At any ⛔, stop,
leave everything as it is, and report.

This runbook builds on `npm-first-publish.md`. These parts of it apply as
written:

- what the agent may run;
- the release decisions, the run state and `guard`;
- §2–§9, Resuming and Rollback.

What this runbook adds is what makes a *later* release safe:

- knowing exactly what changed since the version users already have;
- holding the candidate to the same CAMeL Tools output that version was
  held to;
- choosing the version from the evidence, before anything is committed.

## Run state

This is the run-state block of `npm-first-publish.md`, with these
differences:

- **No version or tag yet.** Leave out `VER`, `TAG`, the stable-version
  check, `BRANCH` and `GITTAG`. §4 adds them once the user has chosen.
- **One package per run.** `PKG` is the package being released. Leave out
  `DBPKG`, `DBVER` and `DBGITTAG`, but keep `PKGDIR`: §2.5 compiles the
  asset in every run, because G12 loads it.
  - **`shanisarf`:** leave out the data package's bump in §2.1, the D gate,
    and the data package's parts of §5 to §8. §7's fresh install still
    loads a published database: before it, set `DBPKG=shanisarf-db-msa`
    and `DBVER` to the version in `$REL/$PKGDIR/package.json`.
  - **`shanisarf-db-msa`:** also set `DBPKG=$PKG`. §4 sets `DBVER=$VER` and
    `DBGITTAG=$GITTAG` too, so the first-publish steps for the data package
    read their usual variables: the bump in `$PKGDIR`, the D gate, and the
    data package's parts of §5 to §8. G1 to G8 still run, since they prove
    the code that reads the asset. Leave out G9 to G12 and `shanisarf`'s
    dry run, publish, log entry and tag.
  - **Both changed** (a new asset format version, say): run this runbook
    once per package, the data package first, as in the first publish.
- **What it names instead:**
  - `PKG`;
  - `LAST=$(npm view "$PKG" dist-tags.latest --registry https://registry.npmjs.org/)`;
  - `LASTTAG=$PKG-v$LAST`;
  - `CAND=$(git -C "$MAIN" rev-parse main)`, or the commit the user names,
    fixed as a SHA.
- **The run directory** comes from
  `mktemp -d "$STATE/$PKG-next.XXXX"`.
- **The rest is unchanged:** `MAIN`, `REG`, `RUN`, `REL`, `OUT`, and the
  same `guard` function appended with a quoted heredoc.
- **Check:** `npm whoami --registry "$REG"` fails with `ENEEDAUTH`.

## 0. Preconditions

1. **Every published version is accounted for.** For each version key of
   `npm view "$PKG" time --json --registry "$REG"`, leaving out `created`
   and `modified`, all three hold:
   - the release log at `CAND` (`git -C "$MAIN" show "${CAND}:docs/releases.md"`)
     has an entry for it;
   - `git rev-parse "$PKG-v<version>^{commit}"` equals that entry's
     `RELSHA`;
   - `git merge-base --is-ancestor "$PKG-v<version>^{commit}" "$CAND"`
     exits 0.

   A version missing from the log, a missing tag, or a release branch not
   merged with its history intact is ⛔. Ask the user to merge it. Never
   rebuild a tag from a guess.
2. **The registry agrees.**
   `npm view "$PKG@$LAST" dist.integrity --registry "$REG"` equals the
   logged `integrity`.
3. **Readiness, re-checked at `CAND`.** `npm-first-publish.md` §1 holds,
   and so do its rows R1, R3, R5, R6 and R8, for `PKG`. R4 holds for every
   package that §1 below puts in class L: nothing committed, bundled or
   distributed is out of range, and every out-of-range development tool is
   on the development-only list.
4. **Committed only.** Uncommitted and untracked files are never part of a
   release, whoever made them.

## 1. Classify what changed

```bash
set -eu; . <release.env>
git -C "$MAIN" log --oneline "$LASTTAG..$CAND"
git -C "$MAIN" diff --name-status "$LASTTAG..$CAND"
```

Use `--name-status`, not `--stat`: `--stat` abbreviates long paths and
loses the directory that decides the class. Put every changed path in
**each** class it matches. A path that matches no class goes in class A.

### A, acceptance

The machinery that certifies parity.

- **Paths:**
  - `tests/`;
  - every `*.test.ts` anywhere with status M, D or R: any edit to an
    existing test, its tables or its expected values;
  - every `*.parity.test.ts` and `*.property.test.ts`;
  - `tools/`, `scripts/` and `fixtures/`;
  - `vitest.config.ts`, `eslint.config.js`, `eslint-rules/`, and the
    `scripts` block of `package.json`;
  - the release decisions in `npm-first-publish.md`.
- **Requirement:**
  - Show the human the full diff in §4, and get an explicit OK.
  - List each changed release decision as old → new. A raised threshold, a
    wider network allowance, a laxer version policy, or a new exception each
    needs its own OK.
  - A test change that rewrites an expected value recorded from CAMeL Tools
    needs the re-recording (the command and its output) in the commit
    message or `CHANGELOG.md`.
  - ⛔ if a change loosens a comparison, adds `.fails`, lowers an expected
    count, or widens an exclusion without a recorded reason.

### L, dependencies

- **Paths:** `package-lock.json`, the dependency fields of `package.json`,
  and `tools/parity/requirements.txt`.
- **Requirement:** R4's license audit for every added or changed package,
  transitive ones included.

### P, pins

- **Paths:** the CAMeL Tools version (the install line in
  `scripts/parity.mjs`, the comments in `requirements.txt`, and the
  notices),
  the database (`tools/parity/fetch_db.py`, `packages/shanisarf-db-msa/source.json`),
  the charmap source, and the toolchain pins.
- **Requirement:**
  - The change came through `upstream-sync.md`, or through a documented
    database or toolchain change.
  - Its record exists: the ledger and the fixture diff counts in the commit
    message, and the `CHANGELOG.md` entry.
  - §2 shows which fixtures it changed, against the last release's log.

### E, engine

- **Paths:** `src/` (the engine, the loader, the compiler, the worker, the
  alignment functions and the typed-features module).
- **Requirement:**
  - Parity is proved in §2 and §5.
  - Output that differs from the fixtures under default options is a port
    bug, or else a default-off option ("Parity before change"). This
    excludes the `referenceRaises` cases the generation fixtures already
    record.
  - A default-on output change is ⛔.

### S, surface

- **Paths:** anything that changes an emitted `.d.ts` or a runtime export
  name.
- **Requirement:** §3's API diff feeds the version choice in §4.

### K, packaging

- **Paths:** `package.json` outside `scripts`, `tsconfig*.json`, `LICENSE`,
  `NOTICE`, `licenses/`, `CHANGELOG.md` and `README.md`.
- **Requirement:** §3's tarball diff. The license files still ship, and
  G10's README checks still pass.

### D, docs only

- **Paths:** `*.md` files that don't ship.
- **Requirement:** no release is needed. Say so, and stop unless the user
  still wants one.

Map each E change to a `CHANGELOG.md` line. Note any that don't map: the
user decides about them in §4, **before** anything is published.

## 2. Worktree at `CAND`, fresh fixtures

Follow `npm-first-publish.md` §2 with three differences:

- Create the worktree with
  `git -C "$MAIN" worktree add --detach "$REL" "$CAND"`. The branch comes in
  §5, once the version is known.
- Skip §2.1 and §2.2.
- In §2.4, HEAD is `CAND`.

### Fixtures against `LAST`

Fixtures are git-ignored, so git cannot compare them. The release log
records, per fixture, the case count and analysis count the generator
printed for `LAST`. Compare `$OUT/generate.log` from §2.3 against that
entry:

- **Equal counts everywhere** means the candidate is held to fixtures of
  the same shape `LAST` was held to. With no class P change, that is the
  expected outcome; the fixtures' content then differs only if the harness
  or a list changed, which is class A and needs the human's OK in §4.
- **A changed count** must trace to a commit in `$LASTTAG..$CAND` of class
  P, L or A that names the fixture. A changed count nothing names is ⛔.

### Pre-candidate tarball

For §3 only; this tarball is never published.

```bash
set -eu; . <release.env>; guard
mkdir -p "$OUT/pre"
(cd "$REL" && npm run clean && npm run build \
  && npm pack --pack-destination "$OUT/pre" --json > "$OUT/pre/pack.json")
```

## 3. Diff against what users have

```bash
set -eu; . <release.env>
mkdir -p "$OUT/prev" "$OUT/prev-x" "$OUT/cand-x"
(cd "$OUT/prev" && npm pack "$PKG@$LAST" --json --registry "$REG" > pack.json)
```

- **Integrity first.** The downloaded tarball's `integrity`, from its
  `pack.json`, must equal the log entry for `LAST`. Until it does, extract
  and run nothing from it. If it differs: ⛔. Someone published outside
  this process.
- **Files.** Once it matches, it is the project's own published code.
  Extract both tarballs, into `$OUT/prev-x` and `$OUT/cand-x`. Then run
  `diff -rq` on the two `package/` directories, and
  `diff -ru -x '*.js'` to see the `.d.ts` files, `package.json`, the README
  and the license files.
- **Runtime API.** Install each tarball into its own consumer under `$OUT`,
  and compare the export names in ESM and in CJS (the two `node -e` lines
  of `npm-first-publish.md` §7). A removed or changed name is breaking.
- **License files.** `LICENSE`, `NOTICE` and `licenses/CAMEL_TOOLS_LICENSE`
  are present in both. Any change to them traces to a commit in
  `$LASTTAG..$CAND`.
- **Sizes.** Give the packed and unpacked deltas against the log. A packed
  size over the threshold in the release decisions is ⛔.

## 4. Choose the version, with the user

| Change | Before 1.0 | From 1.0 |
|---|---|---|
| **Breaking:** an export removed or changed; analysis output changed under default options (including by a class P pin); the `engines` floor raised; a new asset format version | minor (`0.y+1.0`) | major |
| **Additive:** a new export or a new default-off option | patch | minor |
| **Neutral:** a fix, packaging or docs, with the same surface and the same output | patch | patch |

- **Never reuse a version.** `VER` must appear neither in the release log,
  which records every version ever published, unpublished ones included,
  nor among the keys of `npm view "$PKG" time --json`. `npm view …
  versions` leaves out unpublished versions, so it cannot detect a burned
  number.
- **Prereleases.** A prerelease (`0.4.0-rc.1`) goes out with `TAG=next`,
  and `latest` stays on `LAST`. Any other version goes out with
  `TAG=latest`.

Ask the user in one message:

- the proposed `VER` and `TAG`, with the classes and diffs that decided it;
- every class A diff and changed release decision, each for its own
  explicit approval;
- every class L license finding;
- every unmapped engine change, and whether it ships.

Wait for a clear answer on each. Then append to `release.env`: `VER`,
`TAG`, `BRANCH=release/$PKG-v$VER` and `GITTAG=$PKG-v$VER`.

## 5. Bump, prove, gate

1. **Branch and bump.** Run this; it is safe to repeat when resuming:
   ```bash
   set -eu; . <release.env>; guard
   [ "$(git -C "$REL" symbolic-ref --short -q HEAD || true)" = "$BRANCH" ] \
     || git -C "$REL" switch -c "$BRANCH"
   ```
   Then do `npm-first-publish.md` §2.1–§2.2 (bump, CHANGELOG, commit,
   `RELSHA`), and again §2.3–§2.5 (regenerate, check, compile the asset).
2. **Liveness and gate.** Run `npm-first-publish.md` §3 (the liveness
   break), then §4 (the gate).
3. **Nothing lost.** In G5, every fixture's compared-case count equals the
   count in `$OUT/generate.log`, and no fixture's count is lower than the
   log records for `LAST`, except a drop that §2 traced and the user
   approved in §4.
4. **The shipped bytes.** G12 exercises the packed tarball in ESM and
   CommonJS; the fixtures prove `src/`, and G4's build is what the tarball
   holds.
5. **Performance work.** If the change touches the engine's speed or
   memory, `src/engine/result-key-order.test.ts` passes and G8's
   `npm run bench` (with `SHANISARF_PARITY_PYTHON` set, as in
   `npm-first-publish.md` §4) is compared with the README's table and the
   log's figures for `LAST`.
6. **A parity failure is a port bug** (`CONTRIBUTING.md`). ⛔, and report
   the first failing word, mode, `firstDiff` index and both values. Never
   regenerate, edit a fixture, or touch class A files to make the run
   green.

## 6. Publish, verify, record

Follow `npm-first-publish.md` §5–§9 with `$TAG`, with three differences:

- **The first-publish-only rules don't apply.** A prerelease on `next` is
  fine, and the stable-version check is skipped.
- **§7 for `next`:** `latest` must still be on `LAST`.
- **The release-log entry also records:**
  - `LAST`;
  - the change classes;
  - the fixture count comparison (equal, or the named changes);
  - the API and size deltas;
  - the user's answers from §4.

Remind the user that `$BRANCH` must be merged into `main`, with its history
intact, before the next release.

A `shanisarf-db-msa` release follows the same steps, with the data-package
parts named under Run state. Its version follows the database (the release
decisions in `npm-first-publish.md`). A new database is a class P change: a
new `source.json`, a new expected digest, regenerated fixtures and a
regenerated typed-features module, each recorded before any release. A new
asset format version is breaking for `shanisarf` (§4), and the data package
that carries it goes out first.

## 7. Report

- `LAST` → `VER` on `TAG`; `RELSHA`; `integrity`.
- The change classes with their paths, and the fixture count comparison.
- The API and size deltas.
- The gate table and the registry check.
- The user's §4 answers.
- What the human still has to do.
- Any ⛔, with the reason.

## Stop conditions (⛔)

- A published version has no log entry or tag, or isn't merged into `main`.
- The registry's integrity for `LAST` differs from the log.
- A class A change or a loosened release decision isn't approved, or
  loosens the gate without a recorded reason.
- A class L package that is committed, bundled or distributed is out of
  range.
- A class P change has no record.
- A default-on output change.
- A fixture count changed that nothing names.
- A per-fixture count dropped.
- Any gate fails or skips.
- A parity failure.
- The published `LAST` tarball doesn't match the log.
- The version is already used, or doesn't fit the diff.
- Every stop condition in `npm-first-publish.md`, except the
  first-publish-only rules.
