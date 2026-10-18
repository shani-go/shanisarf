# npm release runbook

For an agent. Run top to bottom; every step ends in a check. At any ⛔, stop,
leave everything as it is, and report. Releases are local: no CI, no GitHub
automation, and so no npm provenance (npm generates it only on cloud CI).
The agent prepares and proves; **the human publishes**.

This runbook covers every version of `shanisarf` and `shanisarf-db-msa`
after the first publish (`shanisarf` 0.1.0 and `shanisarf-db-msa` 1.0.0,
2026-10-17; see `releases.md`). What it adds to the gate is what makes a
*later* release safe:

- knowing exactly what changed since the version users already have;
- holding the candidate to the same CAMeL Tools output that version was
  held to;
- choosing the version from the evidence, before anything is committed.

## What the agent may run

- **npm, read-only or local:** `npm ci`, `npm run …`, `npm test -- <files>`,
  `npm pack` (always with `--ignore-scripts` for a tarball the gate
  inspects), `npm ls`, and `npm view --registry "$REG"`.
- **npm, from the registry, into `$OUT/prev` only:**
  `npm pack "$PKG@$LAST" --registry "$REG"` in §3.
- **npm, only in `$REL` and `$REL/$PKGDIR`:**
  `npm version <VER> --no-git-tag-version`.
- **npm, only in `$OUT` consumer directories:** `npm init -y`, `npm install`,
  and `npx --yes <tool>@<version>` for the two type-checking tools in G11.
- **npm, at fixed points:** `npm publish <tarball> --dry-run --registry "$REG"`,
  and `npm whoami --registry "$REG"`, the latter only to confirm that no login
  is active.
- **Human only:** every other npm command that touches the registry or an
  account. That covers `login`, `logout`, a real `publish`, `unpublish`,
  `deprecate`, `undeprecate`, `dist-tag`, `owner`, `access`, `trust`, `stage`,
  `token`, `profile`, `team` and `org`. Never read `~/.npmrc`, print a token,
  or ask for or handle an OTP.
- **Git:**
  - Never push.
  - Never `--force`/`-f`, `-B`/`switch -C`, `branch -D`, `reset`, `restore`,
    `stash`, `clean`, `rebase`, `cherry-pick`, `merge` or `update-ref`.
  - Toward the main tree, only read: `show`, `log`, `diff`, `ls-tree`,
    `cat-file`, `rev-parse`, `merge-base`, `worktree list`, and
    `--no-optional-locks status`. The two exceptions are
    `git -C "$MAIN" worktree add` in §2.1, and `worktree remove` (never
    `--force`) when the user asks for it.
  - Every other git write is `git -C "$REL" …`, in the same command block as
    the guard, after it. The one exception is the liveness break in §6,
    which `git -C "$REL" checkout --` reverts in the same block.
- **Never** change a setting on npmjs.com or GitHub. Draft what the human
  needs, then wait.

## Release decisions

These are fixed here, so that the run can check them rather than wait for
them. Changing one is a class A change (§1) the user approves.

- **Scope.** Two packages, released one per run:
  - `shanisarf` is everything the package root and its `./compile` and
    `./worker` subpaths export: the engine with the generator and
    reinflector, the loader, the compiler, the worker, the alignment
    functions and the typed-features module. Every parity family ships
    (analyzer, word tokenizer, generator, reinflector), so every fixture is
    replayed.
  - `shanisarf-db-msa` is the Camel Morph MSA asset compiled at the release
    commit, with its README and `NOTICE`. It ships no code.
  - When both change (a new asset format version, say), run this runbook
    once per package, the data package first, so `shanisarf` never appears
    on npm needing a database that isn't there. `shanisarf` does not depend
    on the data package; users install both.
- **Versions and tags.** `shanisarf` follows §4's table. The data package's
  version is `<database major>.<database minor>.<release>`, so Camel Morph
  MSA 1.0 gives `1.0.0`, `1.0.1`, …, and a new asset format version is a new
  patch. A stable version goes out on `latest`; a prerelease on `next`.
- **Runtime.** `engines.node` is `>=20`. The toolchain is whatever Node and
  npm the gate ran with; the release log records both.
- **Gates.** §7's two tables. Thresholds: `shanisarf`'s packed tarball at
  most 300 kB; parse, load, memory and µs/word within 1.3× of the README's
  performance table on comparable hardware, otherwise ask. No source maps
  ship. `fetch` appears only in the loader's two read modules
  (`check:invariants` enforces it). The data package's asset digest equals
  the committed `asset-digest.json`.
- **Licenses.** Nothing committed, bundled or distributed is out of range
  (`CONTRIBUTING.md` invariant 1). Development tools that never leave the
  developer's machine are listed, not stopped.
- **Records.** `CHANGELOG.md` at the repository root, shipped in
  `shanisarf`'s tarball; the data package's version table in its README,
  shipped in its tarball; the release log at `docs/releases.md`, not
  shipped, with one entry per published package version.

## Run state and the guard

Agent shells keep neither variables nor the working directory between
calls, and `cd ""` silently stays where it is. The main working tree may hold
other sessions' uncommitted work. So the run state goes into a file, and
every command block from then on starts by sourcing that file's **literal
path** with `set -eu`. Set `PKG` on the third line to the package this run
releases.

```bash
set -eu
MAIN=$(cd "$(git rev-parse --path-format=absolute --git-common-dir)/.." && pwd -P)
[ -d "$MAIN/.git" ] || { echo "MAIN=$MAIN is not the main working tree" >&2; exit 1; }
PKG=shanisarf   # or shanisarf-db-msa
REG=https://registry.npmjs.org/
LAST=$(npm view "$PKG" dist-tags.latest --registry "$REG")
[ "$(npm view "$PKG@$LAST" stub --registry "$REG")" != true ] \
  || { echo "⛔ latest is npm's staged-publishing stub; a publish is still processing" >&2; exit 1; }
STATE="${XDG_STATE_HOME:-$HOME/.local/state}/shanisarf-release"
mkdir -p "$STATE"
D=$(mktemp -d "$STATE/$PKG-next.XXXX")
RUN=$(cd "$D" && pwd -P)
mkdir -p "$RUN/out"
cat > "$RUN/release.env" <<EOF
MAIN=$MAIN
REG=$REG
PKG=$PKG
PKGDIR=packages/shanisarf-db-msa
DBPKG=shanisarf-db-msa
RUN=$RUN
REL=$RUN/rel
OUT=$RUN/out
LAST=$LAST
LASTTAG=$PKG-v$LAST
CAND=$(git -C "$MAIN" rev-parse main)
EOF
cat >> "$RUN/release.env" <<'EOF'
guard() {
  { [ -n "$REL" ] && [ "$(git -C "$REL" rev-parse --show-toplevel)" = "$REL" ] \
    && [ "$REL" != "$MAIN" ] \
    && [ "$(git -C "$REL" rev-parse --path-format=absolute --git-common-dir)" = "$MAIN/.git" ]; } \
  || { echo "GUARD FAILED: REL=$REL" >&2; exit 1; }
}
EOF
echo "$RUN/release.env"
```

- `CAND` is fixed now, as a SHA, because other sessions may commit to
  `main`. If the user names a different commit, edit `CAND` before §2.
- `RUN` lives outside the repository in a durable directory. macOS purges
  `$TMPDIR` within days, and a release can wait days for the human.
- §4 appends `VER`, `TAG`, `BRANCH` and `GITTAG`; §5 appends `RELSHA`; §0
  appends `VENVSUM`. A later line wins when the file is sourced, so a
  corrected value is appended, never edited in.
- `DBVER` is the data package's version: for a `shanisarf` run, §10 sets it
  from `$REL/$PKGDIR/package.json`; for a data-package run, §4 sets
  `DBVER=$VER`.
- Every later block starts with `set -eu; . <printed path>`. Any block that
  writes inside `$REL` calls `guard` first, **in the same block**. `guard`
  is a function because under `set -e`, a failure inside an `&&` list does
  not stop the block; the function ends in `exit 1` so that it does.
- Every path is absolute or `git -C`. A command that must run inside a tree
  runs in a subshell: `(cd "$REL" && …)`.
- The agent's shell may be zsh, where `"$CAND:tools/x"` applies the `:t`
  modifier to `$CAND`. Always brace a variable before a colon:
  `"${CAND}:tools/x"`.
- **Check:** `npm whoami --registry "$REG"` fails with `ENEEDAUTH`. If it
  doesn't, a login is active, and every npm command the agent runs would be
  authenticated: ⛔. Ask the human to log out, and never look in
  `~/.npmrc` to find out why.

## 0. Preconditions

Read every file at `CAND` (`git -C "$MAIN" show "${CAND}:<path>"`), never in
the main working tree. A failing row is work for a commit on `main`, not for
this run: report it and stop.

1. **Every published version is accounted for.** For each version key of
   `npm view "$PKG" time --json --registry "$REG"`, leaving out `created`,
   `modified` and npm's staged-publishing stub (`0.0.0-stage`, whose
   manifest has `"stub": true`; it stays in the version list after every
   first publish and is never a release), all three hold:
   - the release log at `CAND` has an entry for it;
   - `git rev-parse "$PKG-v<version>^{commit}"` equals that entry's
     `RELSHA`;
   - `git merge-base --is-ancestor "$PKG-v<version>^{commit}" "$CAND"`
     exits 0.

   A version missing from the log, a missing tag, or a release branch not
   merged with its history intact is ⛔. Ask the user to merge it. Never
   rebuild a tag from a guess.
2. **The registry agrees.**
   `npm view "$PKG@$LAST" dist.integrity --registry "$REG"` equals the
   logged `integrity`, and `npm view "$PKG" maintainers --registry "$REG"`
   lists only the account the log names.
3. **Records exist.** For `shanisarf`, `CHANGELOG.md` has an "Unreleased"
   section describing what ships. For the data package, §4 checks that its
   README's version table has a row for the chosen version.
4. **The `NOTICE` review.** If anything in `NOTICE`, `licenses/`,
   `$PKGDIR/NOTICE`, `$PKGDIR/README.md` or `$PKGDIR/source.json` changed in
   `$LASTTAG..$CAND`, `NOTICE`'s Review section has a dated entry after
   `LAST`'s release covering the change: the Camel Morph rows re-read against
   the `camel_morph` README at the pinned commit, the CAMeL Tools "What
   shanisarf takes" list against the module map in `design.md`, and `LICENSE`,
   `NOTICE` and `README.md` agreeing on where the upstream notices live.
5. **The checks the gate runs exist** and are the ones `package.json` names:
   `typecheck`, `lint`, `build` (which ends in `check:build`),
   `check:invariants`, `test`, `parity:asset`, `measure:db`, `bench`,
   `compile:db` and `check:consumer`. Each is a report-only script under
   `scripts/`; none edits a tracked file.
6. **Both `package.json` files are publishable.** For both:
   - no `private`;
   - `repository`, `homepage` and `bugs` are set, and the GitHub repository
     they name is public (npmjs.com resolves both READMEs' relative links
     against it);
   - no `dependencies`, `peerDependencies` or `optionalDependencies`;
   - no `preinstall`, `install` or `postinstall` script;
   - `publishConfig` is absent, or holds only `access: public`;
   - no `camel` or `calima` in the name.

   For `shanisarf`: `license` is `MIT`, and `files` includes `dist`,
   `NOTICE`, `licenses` and `CHANGELOG.md`. `prepare` is allowed: it builds
   on a git install and never runs for an installed tarball.

   For `$PKGDIR/package.json`: `license` is `CC-BY-4.0` (the package ships no
   JavaScript); `files` is exactly `asset`, `README.md` and `NOTICE`; there
   is no `scripts`, `main`, `module`, `types` or `bin`; `exports` names only
   `./asset/*` and `./package.json`. `tests/package/data-package.test.ts`
   holds the same shape.
7. **The parity venv holds exactly the pinned closure.**
   `tools/parity/requirements.txt` pins every distribution the analysis path
   loads, each with its license line. The one exception is `camel-tools`
   itself: `scripts/parity.mjs` pins it and installs it with `--no-deps`.

   ```bash
   set -eu; . <release.env>
   git -C "$MAIN" show "${CAND}:tools/parity/smoke_import.py" > "$RUN/smoke_import.py"
   "$MAIN/tools/parity/.venv/bin/python" -I -B "$RUN/smoke_import.py"
   "$MAIN/tools/parity/.venv/bin/python" -I -m pip list --format=freeze | sort > "$RUN/venv.freeze"
   norm() { sed -E 's/[[:space:]]*#.*//' | grep -E '^[A-Za-z0-9._-]+==' \
     | awk -F'==' '{n=tolower($1); gsub(/[-_.]+/,"-",n); print n"=="$2}' | sort -u; }
   { git -C "$MAIN" show "${CAND}:tools/parity/requirements.txt"
     git -C "$MAIN" show "${CAND}:scripts/parity.mjs" | grep -oE 'camel-tools==[0-9][0-9.]*'
   } | norm > "$RUN/venv.expect"
   norm < "$RUN/venv.freeze" | grep -v '^pip==' | diff "$RUN/venv.expect" - \
     || { echo "⛔ the venv is not the pinned closure" >&2; exit 1; }
   ! find "$MAIN"/tools/parity/.venv/lib/python3.*/site-packages -maxdepth 2 -name direct_url.json | grep -q .
   echo "VENVSUM=$(shasum -a 256 < "$RUN/venv.freeze" | cut -d' ' -f1)" >> "$RUN/release.env"
   ```

   `smoke_import` passes, the venv's distributions (names normalized per
   PEP 503) equal the pins exactly apart from `pip`, and none came from a
   direct URL. Rebuilding the venv is the user's decision. Never run
   `parity:setup` to "fix" it: that runs in the main tree.
8. **Pre-flight.**
   - **Toolchain:** `node --version && npm --version`. Node satisfies the
     `engines` of the pinned Vitest and npm. Record both for the log.
   - **Python:** the venv interpreter's `platform.python_version()` equals
     the `python` field of `fixtures/meta/python-whitespace.json` at
     `CAND`. A mismatch is not a stop; note it in the report.
   - **No other run in progress:**
     `pgrep -fl 'vitest|generate\.py|gen-charmaps|parity\.mjs|fetch_db\.py|(^|[ /])pip[0-9.]*( |$)'`
     lists no other session's test run, fixture regeneration, venv install
     or database fetch. If one is running: ⛔, ask. Unrelated programs are
     not a stop; name them in the report.
   - **The database:** `shasum -a 256 "$MAIN/data/camel-morph-msa/msa-v1.0.db"`
     equals `EXPECTED_SHA256` in `tools/parity/fetch_db.py` at `CAND`. If
     the database is missing, ask the user before downloading it.
   - **Charmaps:**
     `ls "$MAIN"/tools/parity/.venv/lib/python3.*/site-packages/camel_tools/utils/charmaps/*_map.json | wc -l`
     prints 21. The charmap parity test silently passes when one is
     missing.
9. **Committed only.** Uncommitted and untracked files are never part of a
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
  - this runbook's release decisions.
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
- **Requirement:** the license audit below for every added or changed
  package, transitive ones included. Nothing committed, bundled or
  distributed is GPL, LGPL, AGPL, MPL, LDC, non-commercial, research-only or
  of unknown license (the hard stop in `CONTRIBUTING.md`):
  - **npm:** walk the changed `packages` entries of
    `git show "${CAND}:package-lock.json"`, including dev, optional and
    platform packages. A missing `license`, a non-SPDX value, or a legacy
    `licenses` array counts as unknown. An out-of-range package without
    `"dev": true` would install with `shanisarf`: ⛔. An out-of-range dev
    package goes on the development-only list.
  - **Parity venv:** for every changed `*.dist-info`, read its name, its
    `License`, `License-Expression` and classifiers, and every
    `License-File` in full; pip's files include the licenses of what it
    vendors. A text search for license names over-matches: the PSF license
    that pip vendors with `distlib` mentions the GPL in its history, and is
    not GPL. The venv is never committed, bundled or distributed, so every
    out-of-range package goes on the development-only list.
  - The development-only list at the first publish: `lightningcss` and its
    platform packages (MPL-2.0, via vite), `certifi` (MPL-2.0, via
    requests), `tqdm` (`MPL-2.0 AND MIT`), and the `certifi` that pip
    vendors (MPL-2.0). The log entry records the current list.

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
  - §2.5 shows which fixtures it changed, against the last release's log.

### E, engine

- **Paths:** `src/` (the engine, the loader, the compiler, the worker, the
  alignment functions and the typed-features module).
- **Requirement:**
  - Parity is proved in §2 and §7.
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

The gate never trusts the git-ignored fixtures in the main tree. They may be
hand-edited, half-regenerated, or written by another session's uncommitted
harness. Instead, it regenerates them in the worktree from the committed
harness.

### 2.1 Worktree

```bash
set -eu; . <release.env>
git -C "$MAIN" worktree list --porcelain | grep -qx "worktree $REL" \
  || git -C "$MAIN" worktree add --detach "$REL" "$CAND"
guard
mkdir -p "$REL/data/camel-morph-msa" "$REL/data/camel-tools-charmaps"
cp "$MAIN/data/camel-morph-msa/msa-v1.0.db" "$REL/data/camel-morph-msa/"
cp "$MAIN"/tools/parity/.venv/lib/python3.*/site-packages/camel_tools/utils/charmaps/*_map.json "$REL/data/camel-tools-charmaps/"
(cd "$REL" && npm ci) > "$OUT/npm-ci.log" 2>&1 || { tail -20 "$OUT/npm-ci.log"; exit 1; }
```

The worktree is detached; the release branch comes in §5, once the version
is known. It gets no `.venv`, not even as a symlink: a symlink shows as
untracked, because `.gitignore`'s `tools/**/.venv/` matches directories
only. Tools that need the venv run the main tree's interpreter with `-I` on
the worktree's scripts, which derive every path from their own location.
The two npm scripts that start Python themselves, `check:invariants` and
`bench`, take that interpreter from `SHANISARF_PARITY_PYTHON`; G3 and G8
set it, and a path that does not exist fails them rather than skipping.
`npm ci` runs `prepare`, which builds `dist/`; G4 rebuilds it from clean.
`npm ci` may warn that `fsevents` has install scripts not covered by
`allowScripts`; it is an optional macOS dev dependency, and the warning is
not a stop.

### 2.2 Regenerate

Do this in one block. Redirect the generator's output rather than piping it
through `tee`, whose exit status would hide a failed guard:

```bash
set -eu; . <release.env>
"$MAIN/tools/parity/.venv/bin/python" -I -m pip list --format=freeze | sort > "$RUN/venv.now"
[ "$(shasum -a 256 < "$RUN/venv.now" | cut -d' ' -f1)" = "$VENVSUM" ] \
  || { echo "⛔ the parity venv changed since §0" >&2; exit 1; }
guard
(cd "$REL" && "$MAIN/tools/parity/.venv/bin/python" -I "$REL/tools/parity/generate.py") \
  > "$OUT/generate.log" 2>&1 || { tail -30 "$OUT/generate.log"; echo "⛔ generate failed" >&2; exit 1; }
```

It takes a few minutes; run it in the background. The generator must pass
all its guards: the version, the database's SHA-256, the canonical vector,
the word-list scan, and the size budget. Its log holds, per fixture, the
case count, and for the generation fixtures the analysis count; §11 records
them, and §2.5 compares against them.

**Tolerated change.** After the run, `git -C "$REL" status --porcelain` may
show only `fixtures/meta/python-whitespace.json`, and only if its diff
changes the `python` field. Restore it:
`guard; git -C "$REL" checkout -- fixtures/meta/python-whitespace.json`.
Any other change, in `fixtures/wordlists/` or elsewhere, means the committed
files are not what the committed harness builds: ⛔.

### 2.3 Check the tree

`git -C "$REL" status --porcelain` prints nothing, and
`git -C "$REL" rev-parse HEAD` equals `CAND` (after §5, `RELSHA`).

### 2.4 Compile the data package's asset

Every run compiles the asset, because G12 loads it and D1 packs it. Compile
it in the worktree, from the worktree's copy of the database. Never copy a
compiled asset from the main tree.

```bash
set -eu; . <release.env>; guard
(cd "$REL" && npm run build && npm run compile:db -- --verify --out "$REL/$PKGDIR/asset") \
  > "$OUT/compile-db.log" 2>&1 \
  || { cat "$OUT/compile-db.log"; echo "⛔ compile:db --verify failed" >&2; exit 1; }
cat "$OUT/compile-db.log"
```

- **Check:** the asset digest, the SHA-256 of the compiled `manifest.json`,
  equals the committed expected digest in `$PKGDIR/asset-digest.json`. That
  file changes only in a reviewed commit that says why. `--verify` exits 1
  on any difference, and lists it, and exits 2 without the database, so
  this step cannot pass by not running.
- The asset's output path is git-ignored, so §2.3's tree is still clean,
  and `npm run clean` (which removes only `dist/`) leaves it in place.

### 2.5 Fixtures against `LAST`

Fixtures are git-ignored, so git cannot compare them. The release log
records, per fixture, the counts the generator printed for `LAST`. Compare
`$OUT/generate.log` against that entry:

- **Equal counts everywhere** means the candidate is held to fixtures of
  the same shape `LAST` was held to. With no class P change, that is the
  expected outcome; the fixtures' content then differs only if the harness
  or a list changed, which is class A and needs the human's OK in §4.
- **A changed count** must trace to a commit in `$LASTTAG..$CAND` of class
  P, L or A that names the fixture. A changed count nothing names is ⛔.

### 2.6 Pre-candidate tarball

For §3 only; this tarball is never published.

```bash
set -eu; . <release.env>; guard
mkdir -p "$OUT/pre"
if [ "$PKG" = "$DBPKG" ]; then
  npm pack "$REL/$PKGDIR" --ignore-scripts --pack-destination "$OUT/pre" --json > "$OUT/pre/pack.json"
else
  (cd "$REL" && npm run clean && npm run build > "$OUT/pre/build.log" 2>&1 \
    && npm pack --ignore-scripts --pack-destination "$OUT/pre" --json > "$OUT/pre/pack.json")
fi
```

Without `--ignore-scripts`, `npm pack` runs `prepare`, which rebuilds
`dist/` and prints the build's output into the JSON.

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
- **Runtime API** (`shanisarf` only). Install each tarball into its own
  consumer under `$OUT`, and compare the export names in ESM and in CJS:

  ```bash
  node --input-type=module -e "import * as m from 'shanisarf'; import * as w from 'shanisarf/worker'; console.log(Object.keys(m).sort().join(' ')); console.log(Object.keys(w).sort().join(' '))"
  node -e "const m=require('shanisarf'); const w=require('shanisarf/worker'); console.log(Object.keys(m).sort().join(' ')); console.log(Object.keys(w).sort().join(' '))"
  ```

  A removed or changed name is breaking.
- **License files.** `LICENSE`, `NOTICE`, `licenses/CAMEL_TOOLS_LICENSE` and
  `licenses/CAMEL_MORPH_LICENSE` are present in both (`NOTICE` alone for the
  data package). Any change to them traces to a commit in
  `$LASTTAG..$CAND`.
- **Sizes.** Give the packed and unpacked deltas against the log. A packed
  size over the threshold in the release decisions is ⛔.

## 4. Choose the version, with the user

| Change | Before 1.0 | From 1.0 |
|---|---|---|
| **Breaking:** an export removed or changed; analysis output changed under default options (including by a class P pin); the `engines` floor raised; a new asset format version | minor (`0.y+1.0`) | major |
| **Additive:** a new export or a new default-off option | patch | minor |
| **Neutral:** a fix, packaging or docs, with the same surface and the same output | patch | patch |

The data package's version follows the database instead (the release
decisions).

- **Never reuse a version.** `VER` must appear neither in the release log,
  which records every version ever published, unpublished ones included,
  nor among the keys of `npm view "$PKG" time --json`. `npm view …
  versions` leaves out unpublished versions, so it cannot detect a burned
  number.
- **Prereleases.** A prerelease (`0.4.0-rc.1`) goes out with `TAG=next`,
  and `latest` stays on `LAST`. Any other version goes out with
  `TAG=latest`.
- **Data package records.** The version table in `$PKGDIR/README.md` at
  `CAND` has a row for `VER`, and the README's asset URL names
  `shanisarf-db-msa@VER`. If not, that is a commit on `main` first: ⛔.

Ask the user in one message:

- the proposed `VER` and `TAG`, with the classes and diffs that decided it;
- every class A diff and changed release decision, each for its own
  explicit approval;
- every class L license finding;
- every unmapped engine change, and whether it ships.

Wait for a clear answer on each. Then append to `release.env`: `VER`,
`TAG`, `BRANCH=release/$PKG-v$VER` and `GITTAG=$PKG-v$VER`, and for a
data-package run `DBVER=$VER`.

## 5. Branch, bump, regenerate

1. **Branch.** Run this; it is safe to repeat when resuming:
   ```bash
   set -eu; . <release.env>; guard
   [ "$(git -C "$REL" symbolic-ref --short -q HEAD || true)" = "$BRANCH" ] \
     || git -C "$REL" switch -c "$BRANCH"
   ```
2. **Bump.** In one block: `guard`, then
   `(cd "$REL" && npm version "$VER" --no-git-tag-version)` for
   `shanisarf`, or `(cd "$REL/$PKGDIR" && npm version "$VER" --no-git-tag-version)`
   for the data package. Never bump the data package's version at the root,
   or the root's in `$PKGDIR`.
3. **Changelog** (`shanisarf`): turn the "Unreleased" section of
   `$REL/CHANGELOG.md` into the entry for `VER`, dated.
4. **Check:** `git -C "$REL" status --porcelain` lists exactly the files
   those steps change: `package.json`, `package-lock.json` and
   `CHANGELOG.md` for `shanisarf`, and `$PKGDIR/package.json` for the data
   package. If it lists anything else, or nothing, the edit went to the
   wrong tree: ⛔.
5. **Commit.** In one block: `guard`, then `git -C "$REL" add` those files
   and `git -C "$REL" commit -m "release $PKG $VER"`. Then
   `echo "RELSHA=$(git -C "$REL" rev-parse HEAD)" >> <release.env>`.
6. **Again §2.2–§2.4** (regenerate, check the tree, compile the asset) at
   `RELSHA`, and their checks.

## 6. Prove the gate can fail

A green run proves nothing if the parity replay cannot go red on this
machine with these fixtures. Break the engine in one line, replay, and
revert, all in one block, so no path can resolve into the main tree:

```bash
set -eu; . <release.env>; guard
perl -pi -e 's/^  return lex\.split\(STRIP_LEX_RE\)\[0\] as string;$/  return lex;/' "$REL/src/engine/features.ts"
[ "$(git -C "$REL" status --porcelain)" = " M src/engine/features.ts" ] || { echo "break not isolated" >&2; exit 1; }
(cd "$REL" && npx vitest run tests/parity --reporter=json --outputFile="$OUT/liveness.json" > "$OUT/liveness.stdout" 2>&1) || true
guard; git -C "$REL" checkout -- src/engine/features.ts; [ -z "$(git -C "$REL" status --porcelain)" ]
```

- **Check:** `$OUT/liveness.json` shows assertion failures (`parity
  mismatch`), not a collection or import error, in the analyzer replay and
  in both generation replays: every stem's `lex` is now unstripped, so
  every lexical analysis and every generated form differs. Record the
  failing-test count per replay. The first publish recorded 532 (analyzer
  369, generator 48, reinflector 115).
- The break not applying (the line changed) means this section is stale:
  fix the runbook first. A replay that passes under the break means the
  gate is vacuous: ⛔.
- The data package has no code to break. D3 replays the same fixtures over
  its shipped asset, so this proof covers it too.

## 7. Gate

Run each row in order, in `$REL`, after `guard`; stop at the first failure.
Keep every command's output under `$OUT`. A skipped check is a failed
check. Several tools exit 0 when they skip:

- the parity suites skip, and Vitest exits 0, when the database is absent;
- `check:invariants` passes when `scan_text` was skipped;
- `measure:db`, `parity:asset` and `bench` exit 0 without the database or
  the venv (`bench` prints `SKIPPED` without `SHANISARF_PARITY_PYTHON` in a
  worktree);
- `check:consumer` skips the asset load when the data package's asset is
  absent;
- the charmap test passes when a map is missing.

A `shanisarf` run passes G1 to G12. A data-package run passes G1 to G8,
which prove the code that reads the asset, and D1 to D3; G9 to G12 don't
apply to it, since it ships no JavaScript and no types. G5 to G8 run for
several minutes; run them in the background.

### Code and `shanisarf`

| Gate | Passes when |
|---|---|
| G1 tree | It runs in the release worktree: not the main tree, on branch `$BRANCH`, with HEAD at `RELSHA` and a clean `git status --porcelain`. |
| G2 static | `npm run typecheck`, and `npm run lint -- --max-warnings=0`. |
| G3 invariants | `SHANISARF_PARITY_PYTHON="$MAIN/tools/parity/.venv/bin/python" npm run check:invariants` exits 0, prints `scan_text:  OK`, and prints no `SKIPPED`. Without the variable, `scan_text` would fall back to a system `python3`. |
| G4 build | `npm run clean && npm run build` exits 0, and `check:build` reports every check ok: no source map in `dist/`; the ported-code notice at the top of every ported module's ESM `.js`, CJS `.js`, ESM `.d.ts` and CJS `.d.ts`; and each entry's `types` resolving, per condition, to the ESM declarations for `import` and to the CJS ones under `dist/cjs/` for `require`. Then record the JavaScript's hashes for Resuming: `(cd "$REL/dist" && find esm cjs -type f ! -name '*.d.ts' \| sort \| xargs shasum -a 256) > "$OUT/dist-js.sha"`. |
| G5 tests | `CI=1 npx vitest run --reporter=json --outputFile="$OUT/test.json"` shows `success`, 0 failed tests and suites, 0 pending and 0 todo. The parity replays ran: each fixture's test count is non-zero and equals its case count in `$OUT/generate.log` plus that fixture's own header tests (one per analyzer fixture, three for each generation fixture, two for the tokenizer). All 21 charmap JSON files are present in `$REL/data/camel-tools-charmaps/`. |
| G6 asset | `npm run parity:asset` compiles the database and replays every fixture over the asset: it prints that every fixture passed. |
| G7 facts | `npm run measure:db` prints that every table count matched, and its parse time and its retained memory after the source is dropped (the "recorded" figure) are within the threshold of the README's table. |
| G8 performance | `SHANISARF_PARITY_PYTHON="$MAIN/tools/parity/.venv/bin/python" npm run bench` runs to the end (every setup agrees on the analysis counts) and its Node rows are within the threshold of the README's table: µs/word, asset load, retained memory, the worker ratio and the lexicon indexes. The README's Chromium row needs `--browser`, which G8 does not run. |
| G9 pack | `npm pack --ignore-scripts --pack-destination "$OUT" --json > "$OUT/pack.json"` runs exactly once. `--ignore-scripts` keeps `prepare` from rebuilding `dist/` after G4–G8 tested it, and keeps the build's output out of the JSON. **Required** in the file list: `package.json`, `README.md`, `LICENSE`, `NOTICE`, `CHANGELOG.md`, `licenses/CAMEL_TOOLS_LICENSE`, `licenses/CAMEL_MORPH_LICENSE`, `dist/**`. **Forbidden:** anything from `src/`, `tests/`, `tools/`, `fixtures/`, `data/`, `docs/` or `packages/`; `.env`; `.npmrc`; any test file; any `.map`. Packed size at most 300 kB. |
| G10 contents | Checked in the extracted tarball under `$OUT/x`. **Manifest:** §0's row 6 holds for the shipped `package.json`, and its `version` is `VER`. **Notices:** every ported engine module's ESM `.js`, CJS `.js`, ESM `.d.ts` and CJS `.d.ts` (under `dist/cjs/`) carries the `Ported from CAMeL Tools` notice; a ported module is a source under `src/engine/` whose first line is the notice (`check:invariants` holds which files must be). CJS files have `"use strict";` above it. **Names:** `camel` and `calima`, matched case-insensitively, appear in no package name, `exports` key, export name (ESM and CJS) or tarball path other than the two verbatim upstream license files, `licenses/CAMEL_TOOLS_LICENSE` and `licenses/CAMEL_MORPH_LICENSE`. **Network:** `grep -rlE 'fetch\(\|XMLHttpRequest\|WebSocket\|importScripts' dist` names only the loader's read modules. **README:** it carries the CAMeL Tools copyright line, the Camel Morph CC BY 4.0 attribution with the license URL, and links to `NOTICE` and the license files; every relative link resolves in the tarball or in the public repository. Its asset URL names `shanisarf-db-msa` at the version in `$PKGDIR/package.json`, its `manifestSha256` example equals `assetDigest` in `$PKGDIR/asset-digest.json`, and it tells users to install `shanisarf-db-msa`. Nothing implies that CAMeL Lab endorses shanisarf; the word "endorses" is expected in the sentence saying so. |
| G11 types | Resolve each tool's version once (`npm view publint version`, `npm view @arethetypeswrong/cli version`) and pin it. In `$OUT/types`, `npx --yes publint@<version> --strict "$OUT/$PKG-$VER.tgz"` prints "All good!", and `npx --yes @arethetypeswrong/cli@<version> --profile node16 "$OUT/$PKG-$VER.tgz"` shows 🟢 for node16 (from CJS), node16 (from ESM) and bundler on every entry, with CJS types under CJS; node10 is ignored by the profile. Record both versions; they are tools run in a scratch directory, not inputs to the repository. A network timeout from npx is a retry, not a result. |
| G12 consumer | `npm run check:consumer` passes: it packs the package, installs it offline into scratch consumers by tarball, by `git+file://` at `RELSHA` and by path, and runs an ESM and a CommonJS script in each (imports, analysis, a lexicon lookup, the alignment functions, a worker, and the data package's asset from §2.4). It prints no `skip`. Record the analysis count it prints for the asset (42 for كتاب at the first publish). It builds and packs its own copy, which rebuilds `$REL/dist`; the gated tarball is `$OUT`'s, packed in G9. |

### `shanisarf-db-msa`

| Gate | Passes when |
|---|---|
| D1 pack | `npm pack "$REL/$PKGDIR" --ignore-scripts --pack-destination "$OUT" --json > "$OUT/pack.json"` runs exactly once. The tarball holds `package.json`, `README.md`, `NOTICE`, `asset/manifest.json`, `asset/header.bin` and `asset/stems.bin`, and nothing else. |
| D2 contents | Checked in the extracted tarball under `$OUT/x-db`. **Manifest:** §0's row 6 holds for the shipped `package.json`, and its `version` is `VER`. **Asset:** the SHA-256 of `asset/manifest.json` equals `assetDigest` in `$PKGDIR/asset-digest.json`; no file has the database's SHA-256 or its size of 84,959,404 bytes. The manifest's `credits`, `license`, `source`, `sourceSha256`, `disclaimer` and `citation` match the root `NOTICE` in meaning, not as substrings: `license` is the SPDX id and URL of the `NOTICE`'s "CC BY 4.0"; `source` is one GitHub URL for the repository, file and pinned commit the `NOTICE` lists separately; `disclaimer` is what the `NOTICE`'s Obligation row requires (the Section 5 pointer, that the asset is an adaptation, and no endorsement). **README and `NOTICE`:** they carry the Camel Morph attribution and citation with the CC BY 4.0 license URL, the README's version table has a row for `VER`, and its asset URL names `$PKG@$VER`. Nothing implies that CAMeL Lab endorses shanisarf. |
| D3 replay | In `$REL`, `SHANISARF_PARITY_ASSET="$OUT/x-db/package/asset" npx vitest run tests/parity` replays every fixture over the shipped asset, and every fixture passes with a non-zero case count. The replay's output does not name the asset; to see that the variable steers it, a nonexistent path fails the analyzer replay with `AssetReadError`. |

Then `chmod a-w "$OUT/$PKG-$VER.tgz"`, and record its `integrity` (sha512),
`shasum`, file count, and packed and unpacked bytes, from `$OUT/pack.json`.

Also, for every run:

1. **Nothing lost.** In G5, every fixture's compared-case count equals the
   count in `$OUT/generate.log`, and no fixture's count is lower than the
   log records for `LAST`, except a drop that §2.5 traced and the user
   approved in §4.
2. **The shipped bytes.** G12 exercises the packed tarball in ESM and
   CommonJS; the fixtures prove `src/`, and G4's build is what the tarball
   holds.
3. **Performance work.** If the change touches the engine's speed or
   memory, `src/engine/result-key-order.test.ts` passes and G8's figures
   are compared with the log's figures for `LAST` as well as the README's.
4. **A parity failure is a port bug** (`CONTRIBUTING.md`). ⛔, and report
   the first failing word, mode, `firstDiff` index and both values. Never
   regenerate, edit a fixture, or touch class A files to make the run
   green.

## 8. Dry run

```bash
set -eu; . <release.env>
npm publish "$OUT/$PKG-$VER.tgz" --dry-run --tag "$TAG" --registry "$REG"
echo "sha512-$(openssl dgst -sha512 -binary "$OUT/$PKG-$VER.tgz" | base64)"
```

- **Check:** it says `Publishing to https://registry.npmjs.org/ with tag
  $TAG`, then `+ $PKG@$VER`. The warning that the command needs a login is
  expected: the agent is not logged in.
- **Check:** the computed integrity equals the one recorded in §7.
  Otherwise the tarball changed after the gate: ⛔.
- A dry run does not detect `private: true`; G10 and D2 do. Publishing a
  tarball runs no lifecycle scripts, so the bytes that passed the gate are
  the bytes that are uploaded. Never publish from a directory.

## 9. Hand the publish to the human

Ask in chat. Give the package's name, version and tag; the tarball's path
and `integrity`; the file count and packed size; `RELSHA`; and the gate
table with its evidence. Wait for a clear yes.

The human logs in, in **their own terminal**, with a throwaway config, so
the session token stays out of `~/.npmrc` and neither the agent nor any
other session runs authenticated. They may do this at any point before the
publish; the agent's `npm whoami` keeps failing with `ENEEDAUTH`, because
it reads `~/.npmrc`. Give them the lines one at a time, with the paths
filled in; the variable `U` lives only in that terminal, so the same tab
must stay open until the logout:

```bash
U=$(mktemp -d)/npmrc
npm login --registry https://registry.npmjs.org/ --userconfig "$U"
npm whoami --registry https://registry.npmjs.org/ --userconfig "$U"
npm publish "<OUT>/<PKG>-<VER>.tgz" --tag <TAG> --registry https://registry.npmjs.org/ --userconfig "$U"
npm logout --registry https://registry.npmjs.org/ --userconfig "$U"; rm -f "$U"
```

- **Login and 2FA happen in the browser.** `npm login` prints a
  `npmjs.com/login/cli/…` URL and waits for ENTER to open it. `npm publish`
  prints the tarball's details, then an `npmjs.com/auth/cli/…` URL for the
  publish's 2FA. Its shasum and integrity lines must match §7's. A notice
  that "tokens that bypass 2FA are being restricted" is npm's general
  announcement, not a problem with this login.
- **Always log out.** Tell the human to run the last line whether or not
  the publish succeeded. Before §10, `npm whoami --registry "$REG"` must
  still fail with `ENEEDAUTH` in the agent's shell.
- **A 403** "too similar to an existing package" is ⛔.
- **Wait** for the human to report the result. If they don't say, read the
  publish's last lines in their terminal when the session can; a success
  ends in `+ <PKG>@<VER>`. Don't poll the registry in a loop.

## 10. Verify the registry copy

- **Pending, not a mismatch.** npm publishes in stages: the publish prints
  "Your package is being processed and may take a few minutes to become
  available". Until then the registry can show only the stub `0.0.0-stage`
  (`"stub": true`, "Temporary package placeholder for staged publishing")
  as the newest version, with `latest` on it, and its answers, 404s
  included, are cached for up to five minutes. Within about 15 minutes of a
  publish, an E404, a missing version, the stub or an old dist-tag means
  "not visible yet". Check again once, after about five minutes.
- **Then check:**
  - `npm view "$PKG@$VER" dist.integrity --registry "$REG"` equals the
    recorded `integrity`;
  - `npm view "$PKG" dist-tags --registry "$REG"` shows `$TAG` on `VER`,
    and for `next`, `latest` still on `LAST`;
  - `npm view "$PKG" maintainers --registry "$REG"` lists only the
    expected account.
- **Fresh install, both packages together.** For a `shanisarf` run, first
  append `DBVER=$(node -p "require('$REL/$PKGDIR/package.json').version")`
  to `release.env`. For a data-package run, install `shanisarf` at its
  `latest` beside it; if this data package carries a new asset format
  version that no published `shanisarf` reads yet, install and check its
  integrity only, and leave the load to the `shanisarf` run. In one block:

  ```bash
  set -eu; . <release.env>
  DIGEST=$(node -p "require('$REL/$PKGDIR/asset-digest.json').assetDigest")
  mkdir -p "$OUT/registry" && cd "$OUT/registry" && npm init -y > /dev/null
  npm install --no-audit --no-fund "$DBPKG@$DBVER" "shanisarf@<VER, or latest for a data-package run>" --registry "$REG"
  node --input-type=module -e "import * as m from 'shanisarf'; import * as w from 'shanisarf/worker'; console.log(Object.keys(m).sort().join(' ')); console.log(Object.keys(w).sort().join(' '))" > esm.txt
  node -e "const m=require('shanisarf'); const w=require('shanisarf/worker'); console.log(Object.keys(m).sort().join(' ')); console.log(Object.keys(w).sort().join(' '))" > cjs.txt
  diff esm.txt cjs.txt
  DIGEST="$DIGEST" node --input-type=module -e "import { loadDatabase, Analyzer } from 'shanisarf'; const db = await loadDatabase(import.meta.resolve('$DBPKG/asset/manifest.json'), { manifestSha256: process.env.DIGEST }); console.log(new Analyzer(db).analyze('كتاب').length)"
  ```

  Each installed `package.json` has the expected version. The two export
  lists are equal and match the gated tarball's. Each installed package's
  `integrity` in `package-lock.json` equals the recorded one for the
  package this run published. The last line prints the analysis count G12
  recorded.
- **Account setting.** Each package's npmjs.com → Settings → Publishing
  access was set to "Require two-factor authentication and disallow tokens"
  at the first publish. Ask the human to confirm it is still set.
- A **confirmed** integrity, tag or maintainer difference: ⛔, and go to
  Rollback with the human. Once the human has published, a ⛔ here still
  runs §11, with the entry marked `verification failed: <reason>`, because
  every published version must be in the log and tagged.

## 11. Record and tag

- **Log entry.** Append one entry to `$REL/docs/releases.md`, in the shape
  of the entries already there:
  - date, package, version, tag, `RELSHA` and git tag;
  - `integrity`, `shasum`, file count, packed and unpacked bytes;
  - who published, and how;
  - `LAST`, the change classes, and the user's answers from §4;
  - the fixture count comparison with `LAST` (equal, or the named changes),
    and the API and size deltas;
  - the gate table, and the registry check;
  - every ⛔ during the run, with its fix and any ruling the user made.

  `shanisarf`'s entry also covers the per-fixture counts from
  `$OUT/generate.log`, the liveness failure counts from §6, the Vitest
  count, Node, npm, Vitest and Python versions, the database's SHA-256, the
  development-only license list, and the measured parse, load, memory and
  µs/word figures. The data package's entry also covers the asset digest
  and D3's per-fixture case counts.
- **Commit.** First check that `git -C "$REL" status --porcelain` lists
  exactly `docs/releases.md`; anything else means the edit went to the
  wrong tree: ⛔. Then, in one block, `guard` and commit it on `$BRANCH` as
  `record release $PKG $VER`.
- **Tag** the published commit, not the record commit:
  `git -C "$REL" tag -a "$GITTAG" "$RELSHA" -m "$PKG $VER"`. Read it back
  with `git rev-parse "$GITTAG^{commit}"`. A plain `rev-parse` on an
  annotated tag returns the tag object instead.
- **Merge, push and clean up are the human's.** `$BRANCH` must be merged
  into `main` with its history intact before the next release: a
  `--no-ff` merge or a true fast-forward, never a squash or rebase, since
  §0 reads the log and tags from `main`. Give the human these, for their
  terminal, one at a time:

  ```bash
  git -C "<MAIN>" merge --no-ff "<BRANCH>" -m "merge release <PKG> <VER>"
  git -C "<MAIN>" push origin main "<GITTAG>"
  ```

  After the push, ask whether to remove the worktree
  (`git -C "$MAIN" worktree remove "$REL"`, the agent's to run when asked);
  the merged branch is then the human's to delete with
  `git branch -d "<BRANCH>"`. The run directory under `$STATE` holds the
  tarball and every gate log; once the log entry is on `main`, it can be
  moved to the Trash when the user asks.

## 12. Report

- `LAST` → `VER` on `TAG`; `RELSHA`; `integrity`.
- The change classes with their paths, and the fixture count comparison.
- The API and size deltas.
- The gate table with its evidence, and the registry check.
- The user's §4 answers, and every ruling during the run.
- What the human still has to do: the merge, the push, the account
  setting.
- Any ⛔, with the reason.

## Resuming after a ⛔

- **Same commit.** When the fix needs no new commit (the environment, the
  venv, the database, a user ruling), resume the same run: source the same
  `release.env`, and never re-run the run-state block. If the env path is
  lost, `git -C "$MAIN" worktree list --porcelain` shows `$RUN/rel`, so the
  file is `$RUN/release.env`.
- **New commit, before §5.** The worktree is detached and nothing is
  committed. This run ends: ask the user whether to remove `$REL`, and start
  a fresh run state once the fix is on `main`.
- **New commit, after §5, before the publish.** Two ways, and the user
  chooses:
  - **Restart.** This run ends. The version is still free. Ask the user to
    remove `$REL` (`git worktree remove`) and to delete the unpublished
    `$BRANCH` themselves (`git branch -D` is theirs to run), since a fresh
    run's §5 creates a branch of the same name. Then start a fresh run
    state once the fix is on `main`.
  - **Fix on the release branch.** Only for a fix to the build, the
    packaging or this runbook, one that changes nothing under `src/`,
    `tools/`, `fixtures/` or `tests/parity/`. Commit it with
    `git -C "$REL"` after `guard`, append the new `RELSHA`, and move every
    superseded tarball and log under `$OUT/superseded/` (a gated tarball is
    discarded only with the user's agreement). Redo G1 to G5. If
    `(cd "$REL/dist" && find esm cjs -type f ! -name '*.d.ts' | sort | xargs shasum -a 256)`
    equals `$OUT/dist-js.sha` from G4, the JavaScript is byte-identical, so
    §2, §6 and G6 to G8 stand; otherwise redo them too. Then continue from
    G9 (from D1 for a data-package run). The fix reaches `main` with the
    merge in §11, and the log entry records it. The first publish took this
    way twice, for the `.d.ts` notices and for the CommonJS types.
- **After the publish,** the version is spent. A fix goes out as a new
  version, through a new run.
- **The gated tarball is read-only.** Packing a new one needs the user's
  agreement to discard the old one.

## Rollback (human only)

- **A defect:** `npm deprecate "<pkg>@<bad>" "<reason>; use <good>"
  --registry https://registry.npmjs.org/`, then publish a fixed version
  through this runbook.
- **Bytes that must not be out at all** (a license defect, for example):
  `npm unpublish "<pkg>@<bad>"`.
  - Within 72 hours, this needs only that nothing depends on the package.
    After 72 hours, it also needs fewer than 300 downloads in the last week
    and a single owner.
  - Either way, the version number is burned forever, and mirrors keep
    their copies.
  - Record any unpublish in the release log, so later version choices skip
    it.
- **Both packages:** roll back only the package with the defect. If both
  must go, roll back `shanisarf` first, so it is never on npm without its
  database.

## Stop conditions (⛔)

- A login is active when it shouldn't be, or `latest` is npm's stub.
- A published version has no log entry or tag, or isn't merged into `main`.
- The registry's integrity or maintainers for `LAST` differ from the log.
- A precondition row fails, or another run is in progress.
- The guard fails.
- The venv changes during the run.
- A class A change or a loosened release decision isn't approved, or
  loosens the gate without a recorded reason.
- A class L package that is committed, bundled or distributed is out of
  range.
- A class P change has no record.
- A default-on output change.
- A fixture count changed that nothing names, or a per-fixture count
  dropped.
- Regeneration fails a guard, or changes a committed file beyond the
  tolerated diff.
- The compiled asset's digest differs from `asset-digest.json`.
- The liveness break won't apply, or the replay passes under it.
- Any gate fails or skips, or a parity failure.
- The published `LAST` tarball doesn't match the log.
- The version is already used, or doesn't fit the diff.
- The tarball changes after the gate.
- The dry run doesn't print the expected registry, name, version and tag.
- The registry refuses the name.
- A confirmed integrity, tag or maintainer difference after the publish.
- Anything that would need a credential, OTP or token to pass through the
  agent.
