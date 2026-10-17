# First npm publish runbook

For an agent. Run top to bottom; every step ends in a check. At any ⛔, stop,
leave everything as it is, and report. Releases are local: no CI, no GitHub
automation, and so no npm provenance (npm generates it only on cloud CI).
The agent prepares and proves; **the human publishes**.

One run publishes both packages for the first time, from one release
commit: the data package `shanisarf-db-msa` first, then `shanisarf`. Use
this runbook once. Every later version of either package uses
`npm-release.md`, which reuses this runbook's run state, guard, §2–§9,
Resuming section and Rollback.

## What the agent may run

- **npm, read-only or local:** `npm ci`, `npm run …`, `npm test -- <files>`,
  `npm pack`, `npm ls`, and `npm view --registry "$REG"`.
- **npm, only in `$REL` and `$REL/$PKGDIR`:**
  `npm version <VER> --no-git-tag-version`.
- **npm, only in `$OUT` consumer directories:** `npm init -y`, `npm install`,
  and `npx --yes <tool>@<version>` for the two type-checking tools in §4.
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
    `git -C "$MAIN" worktree add` in §2, and `worktree remove` (never
    `--force`) when the user asks for it.
  - Every other git write is `git -C "$REL" …`, in the same command block as
    the guard, after it. The one exception is the liveness break in §3,
    which `git -C "$REL" checkout --` reverts in the same block.
- **Never** change a setting on npmjs.com or GitHub. Draft what the human
  needs, then wait.

## Release decisions

These are fixed here, so that §0 can check them rather than wait for them.
Changing one is a documentation change the user approves before the run.

- **Scope.** Two packages, one release commit:
  - `shanisarf` is everything the package root and its `./compile` and
    `./worker` subpaths export: the engine with the generator and
    reinflector, the loader, the compiler, the worker, the alignment
    functions and the typed-features module. Every parity family ships
    (analyzer, word tokenizer, generator, reinflector), so every fixture is
    replayed.
  - `shanisarf-db-msa` is the Camel Morph MSA v1.0 asset compiled at the
    release commit, with its README and `NOTICE`. It ships no code.
- **Order.** The data package is published before `shanisarf`, so
  `shanisarf` never appears on npm without the database its README tells
  users to install. Both can go out in one sitting, or the data package
  alone first and `shanisarf` later from the same gated tarball (§6).
  `shanisarf` does not depend on the data package; users install both.
- **Versions and tag.** `shanisarf` 0.1.0 and `shanisarf-db-msa` 1.0.0, both
  on `latest`. The data package's version is
  `<database major>.<database minor>.<release>`, so Camel Morph MSA 1.0 gives
  `1.0.0`, `1.0.1`, …, and a new asset format version is a new patch. Later
  versions follow `npm-release.md` §4. Prereleases go on `next`.
- **Runtime.** `engines.node` is `>=20`. The toolchain is whatever Node and
  npm the gate ran with; the release log records both.
- **Gates.** §4's two tables. Thresholds: `shanisarf`'s packed tarball at
  most 300 kB; parse, load, memory and µs/word within 1.3× of the README's
  performance table on comparable hardware, otherwise ask. No source maps
  ship. `fetch` appears only in the loader's two read modules
  (`check:invariants` enforces it). The data package's asset digest equals
  the committed `asset-digest.json`.
- **Licenses.** Nothing committed, bundled or distributed is out of range
  (`CONTRIBUTING.md` invariant 1). Development tools that never leave the
  developer's machine are listed, not stopped (R4).
- **Records.** `CHANGELOG.md` at the repository root, shipped in
  `shanisarf`'s tarball; the data package's version table in its README,
  shipped in its tarball; the release log at `docs/releases.md`, not
  shipped, with one entry per published package version.

## Run state and the guard

Agent shells keep neither variables nor the working directory between
calls, and `cd ""` silently stays where it is. The main working tree may hold
other sessions' uncommitted work. So the run state goes into a file, and
every command block from then on starts by sourcing that file's **literal
path** with `set -eu`:

```bash
set -eu
MAIN=$(cd "$(git rev-parse --path-format=absolute --git-common-dir)/.." && pwd -P)
[ -d "$MAIN/.git" ] || { echo "MAIN=$MAIN is not the main working tree" >&2; exit 1; }
PKG=shanisarf; VER=0.1.0; TAG=latest   # a first publish is always stable on latest
DBPKG=shanisarf-db-msa; DBVER=1.0.0
for v in "$VER" "$DBVER"; do
  case "$v" in *-*|*+*) echo "⛔ a first publish needs stable versions" >&2; exit 1;; esac
done
STATE="${XDG_STATE_HOME:-$HOME/.local/state}/shanisarf-release"
mkdir -p "$STATE"
D=$(mktemp -d "$STATE/$PKG-$VER.XXXX")
RUN=$(cd "$D" && pwd -P)
mkdir -p "$RUN/out"
cat > "$RUN/release.env" <<EOF
MAIN=$MAIN
REG=https://registry.npmjs.org/
PKG=$PKG
VER=$VER
TAG=$TAG
DBPKG=$DBPKG
DBVER=$DBVER
PKGDIR=packages/$DBPKG
RUN=$RUN
REL=$RUN/rel
OUT=$RUN/out
BRANCH=release/$PKG-v$VER
GITTAG=$PKG-v$VER
DBGITTAG=$DBPKG-v$DBVER
BASE=$(git -C "$MAIN" rev-parse main)
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

- `PKG`, `VER` and `GITTAG` name `shanisarf`; `DBPKG`, `DBVER` and
  `DBGITTAG` name the data package, whose directory is `PKGDIR`. One release
  branch and one release commit carry both.
- `MAIN` is always the main working tree, even when this session runs in a
  linked worktree.
- `RUN` lives outside the repository in a durable directory. macOS purges
  `$TMPDIR` within days, and a release can wait days for the human.
- `BASE` is fixed now, as a SHA, because other sessions may commit to
  `main`. If the user names a different commit, edit `BASE` before §2.
- Every later block starts with `set -eu; . <printed path>`. Any block that
  writes inside `$REL` calls `guard` first, **in the same block**.
- `guard` is a function because under `set -e`, a failure inside an `&&`
  list does not stop the block. The function ends in `exit 1` so that it
  does.
- Every path is absolute or `git -C`. A command that must run inside a tree
  runs in a subshell: `(cd "$REL" && …)`.
- **Check:** `npm whoami --registry "$REG"` fails with `ENEEDAUTH`. If it
  doesn't, a login is active, and every npm command the agent runs would be
  authenticated: ⛔. Ask the human to log out, and never look in
  `~/.npmrc` to find out why.

## 0. Readiness (⛔ unless every row holds)

The first publish is the point of no return. A `name@version` can never be
reused, even after an unpublish, and registry mirrors keep copies. Check
every row at `BASE` (`git -C "$MAIN" show "${BASE}:<path>"`), never in the
main working tree. A failing row is work for a commit on `main`, not for
this run: report it and stop.

**R1. The records exist at `BASE`.** `CHANGELOG.md` has an "Unreleased"
section, or an entry for `VER`, describing what ships. The version table in
`$PKGDIR/README.md` has a row for `DBVER`. `docs/releases.md` exists (empty
but for its heading is fine).

**R2. Withdrawn.** Contacting CAMeL Lab is no longer part of the plan. The
number stays so that R3 to R8 keep theirs.

**R3. The `NOTICE` review is done and dated:**

- the Camel Morph rows have been re-read against the `camel_morph` README at
  the pinned commit;
- the CAMeL Tools "What shanisarf takes" list matches the module map in
  `design.md`;
- `LICENSE`, `NOTICE` and `README.md` agree on where the upstream notice
  lives;
- `$PKGDIR/NOTICE` and `$PKGDIR/README.md` carry the root `NOTICE`'s Camel
  Morph attribution and citation (`check:invariants` compares them).

**R4. Licenses.** Nothing committed, bundled or distributed is GPL, LGPL,
AGPL, MPL, LDC, non-commercial, research-only or of unknown license. This
is the hard stop in `CONTRIBUTING.md`. Development tools that run only on
the developer's machine are outside it: list them, don't stop on them.
Check both trees:

- **npm:** walk every `packages` entry of
  `git show "${BASE}:package-lock.json"`, including dev, optional and
  platform packages. A missing `license`, a non-SPDX value, or a legacy
  `licenses` array counts as unknown. An out-of-range package without
  `"dev": true` would install with `shanisarf`: ⛔. An out-of-range dev
  package goes on the development-only list.
- **Parity venv:** for every `*.dist-info`, read its name, its `License`,
  `License-Expression` and classifiers, and every `License-File` in full.
  Some packages declare their license only through the file, and pip's
  files include the licenses of what it vendors. The venv is never
  committed, bundled or distributed, so every out-of-range package goes on
  the development-only list.
- **The shipped bytes:** G9, G10, D1 and D2 prove that the two tarballs
  hold only the project's own files.

Expect on today's tree, all development-only: `lightningcss` and its
platform packages (MPL-2.0, via vite), `certifi` (MPL-2.0, via requests),
`tqdm` (`MPL-2.0 AND MIT`), and the `certifi` that pip vendors (MPL-2.0).
§8 records the list in the release log.

**R5. The parity venv holds exactly the pinned closure.**
`tools/parity/requirements.txt` pins every distribution the analysis path
loads, including requests' dependencies, each with its license line. The
one exception is `camel-tools` itself: `scripts/parity.mjs` pins it and
installs it with `--no-deps`, because a requirements line would pull its
whole dependency tree.

```bash
set -eu; . <release.env>
git -C "$MAIN" show "${BASE}:tools/parity/smoke_import.py" > "$RUN/smoke_import.py"
"$MAIN/tools/parity/.venv/bin/python" -I -B "$RUN/smoke_import.py"
"$MAIN/tools/parity/.venv/bin/python" -I -m pip list --format=freeze | sort > "$RUN/venv.freeze"
norm() { sed -E 's/[[:space:]]*#.*//' | grep -E '^[A-Za-z0-9._-]+==' \
  | awk -F'==' '{n=tolower($1); gsub(/[-_.]+/,"-",n); print n"=="$2}' | sort -u; }
{ git -C "$MAIN" show "${BASE}:tools/parity/requirements.txt"
  git -C "$MAIN" show "${BASE}:scripts/parity.mjs" | grep -oE 'camel-tools==[0-9][0-9.]*'
} | norm > "$RUN/venv.expect"
norm < "$RUN/venv.freeze" | grep -v '^pip==' | diff "$RUN/venv.expect" - \
  || { echo "⛔ R5: the venv is not the pinned closure" >&2; exit 1; }
! find "$MAIN"/tools/parity/.venv/lib/python3.*/site-packages -maxdepth 2 -name direct_url.json | grep -q .
echo "VENVSUM=$(shasum -a 256 < "$RUN/venv.freeze" | cut -d' ' -f1)" >> "$RUN/release.env"
```

- **Check:** `smoke_import` passes. The venv's distributions, with names
  normalized per PEP 503 (pip prints `camel_tools` where the pin says
  `camel-tools`), equal the pins in both files exactly, apart from `pip`
  itself. No distribution was installed from a direct URL. `VENVSUM` is
  saved; §2.3 rechecks it before every regeneration.
- **Rebuilding the venv** is the user's decision. Never run `parity:setup`
  to "fix" it: that runs in the main tree.

**R6. The checks the gate runs exist at `BASE`** and are the ones
`package.json` names: `typecheck`, `lint`, `build` (which ends in
`check:build`), `check:invariants`, `test`, `parity:asset`, `measure:db`,
`bench`, `compile:db` and `check:consumer`. Each is a report-only script
under `scripts/`; none edits a tracked file.

**R7. The names are free.** Run
`npm view "$PKG" name --registry "$REG"` and the same for `$DBPKG`; each
gives E404. So do `shani-sarf`, `shani_sarf`, `shani.sarf`,
`shanisarfdbmsa`, `shanisarf_db_msa`, `shanisarf.db.msa` and
`shanisarf-dbmsa`. The registry also refuses a name equal to an existing
one once punctuation is removed, and it checks only at publish time, so a
dry run cannot prove a name is accepted.

**R8. Both `package.json` files at `BASE` are publishable.** For both:

- no `private`;
- `repository`, `homepage` and `bugs` are set;
- no `dependencies`, `peerDependencies` or `optionalDependencies`;
- no `preinstall`, `install` or `postinstall` script;
- `publishConfig` is absent, or holds only `access: public`;
- no `camel` or `calima` in the name;
- `version` is below its target (`VER` or `DBVER`; §2.1 bumps it) or equal
  to it.

For `shanisarf`: `license` is `MIT`, and `files` includes `dist`, `NOTICE`,
`licenses` and `CHANGELOG.md`. `prepare` is allowed: it builds on a git
install and never runs for an installed tarball.

For `$PKGDIR/package.json`: `license` is `CC-BY-4.0` (the package ships no
JavaScript); `files` is exactly `asset`, `README.md` and `NOTICE`; there is
no `scripts`, `main`, `module`, `types` or `bin`; `exports` names only
`./asset/*` and `./package.json`. `tests/package/data-package.test.ts`
holds the same shape.

The GitHub repository named in `repository` is public, since npmjs.com
resolves both READMEs' relative links against it. Otherwise neither README
may link anything that would 404 there. Ask the human if unsure.

## 1. Pre-flight

- **Toolchain:** run `node --version && npm --version`. Node satisfies the
  `engines` of the pinned Vitest and npm. Record both for the log.
- **Python:** compare the venv interpreter's `platform.python_version()`
  with the `python` field of `fixtures/meta/python-whitespace.json` at
  `BASE`. A mismatch is not a stop; note it in the report.
- **No other run in progress:** run
  `pgrep -fl 'vitest|generate\.py|gen-charmaps|parity\.mjs|fetch_db\.py|(^|[ /])pip[0-9.]*( |$)'`.
  It must list no other session's test run, fixture regeneration, venv
  install or database fetch. If one is running: ⛔, ask. Unrelated programs
  are not a stop; name them in the report.
- **The database:** `shasum -a 256 "$MAIN/data/camel-morph-msa/msa-v1.0.db"`
  equals `EXPECTED_SHA256` in `tools/parity/fetch_db.py` at `BASE`. If the
  database is missing, ask the user before downloading it.
- **Charmaps:** `ls "$MAIN"/tools/parity/.venv/lib/python3.*/site-packages/camel_tools/utils/charmaps/*_map.json | wc -l`
  prints 21. These come from the pinned CAMeL Tools package, and they are
  what the charmap parity test compares against. That test silently passes
  when one is missing.

## 2. Release worktree and fresh fixtures

The gate never trusts the git-ignored fixtures in the main tree. They may be
hand-edited, half-regenerated, or written by another session's uncommitted
harness. Instead, it regenerates them in the worktree from the committed
harness.

```bash
set -eu; . <release.env>
git -C "$MAIN" worktree list --porcelain | grep -qx "worktree $REL" \
  || git -C "$MAIN" worktree add -b "$BRANCH" "$REL" "$BASE"
guard
mkdir -p "$REL/data/camel-morph-msa" "$REL/data/camel-tools-charmaps"
cp "$MAIN/data/camel-morph-msa/msa-v1.0.db" "$REL/data/camel-morph-msa/"
cp "$MAIN"/tools/parity/.venv/lib/python3.*/site-packages/camel_tools/utils/charmaps/*_map.json "$REL/data/camel-tools-charmaps/"
(cd "$REL" && npm ci)
```

The worktree gets no `.venv`, not even as a symlink. A symlink shows as
untracked, because `.gitignore`'s `tools/**/.venv/` matches directories
only. Tools that need the venv run the main tree's interpreter with `-I` on
the worktree's scripts, which derive every path from their own location.
The two npm scripts that start Python themselves, `check:invariants` and
`bench`, take that interpreter from `SHANISARF_PARITY_PYTHON`; §4 sets it
for G3 and G8.
`npm ci` runs `prepare`, which builds `dist/`; §4 rebuilds it from clean.

### 2.1 Version

If `$REL/package.json` is below `VER`, or `$REL/$PKGDIR/package.json` is
below `DBVER`:

1. In one block: `guard`, then whichever of these applies:
   `(cd "$REL" && npm version "$VER" --no-git-tag-version)` and
   `(cd "$REL/$PKGDIR" && npm version "$DBVER" --no-git-tag-version)`.
   Never bump the data package's version at the root, or the root's in
   `$PKGDIR`.
2. If `shanisarf` was bumped, turn the "Unreleased" section of
   `$REL/CHANGELOG.md` into the entry for `VER`, dated.
3. **Check:** `git -C "$REL" status --porcelain` lists exactly the files
   those steps change: `package.json`, `package-lock.json` and
   `CHANGELOG.md` for `shanisarf`, and `$PKGDIR/package.json` for the data
   package. If it lists anything else, or nothing, the edit went to the
   wrong tree: ⛔.
4. In one block: `guard`, then `git -C "$REL" add` those files and
   `git -C "$REL" commit -m "release $PKG $VER, $DBPKG $DBVER"`.

### 2.2 Record RELSHA

`echo "RELSHA=$(git -C "$REL" rev-parse HEAD)" >> <release.env>`.

### 2.3 Regenerate

Do this in one block:

```bash
set -eu; . <release.env>
"$MAIN/tools/parity/.venv/bin/python" -I -m pip list --format=freeze | sort > "$RUN/venv.now"
[ "$(shasum -a 256 < "$RUN/venv.now" | cut -d' ' -f1)" = "$VENVSUM" ] \
  || { echo "⛔ the parity venv changed since R5" >&2; exit 1; }
guard
(cd "$REL" && "$MAIN/tools/parity/.venv/bin/python" -I "$REL/tools/parity/generate.py" | tee "$OUT/generate.log")
```

The generator must pass all its guards: the version, the database's
SHA-256, the canonical vector, the word-list scan, and the size budget.
Its log holds, per fixture, the case count and analysis count; §8 records
them, and `npm-release.md` compares a later candidate against them.

**Tolerated change.** After the run, `git -C "$REL" status --porcelain` may
show only `fixtures/meta/python-whitespace.json`, and only if its diff
changes the `python` field. Restore it:
`guard; git -C "$REL" checkout -- fixtures/meta/python-whitespace.json`.
Any other change, in `fixtures/wordlists/` or elsewhere, means the committed
files are not what the committed harness builds: ⛔.

### 2.4 Check the tree

`git -C "$REL" status --porcelain` prints nothing, and
`git -C "$REL" rev-parse HEAD` equals `RELSHA`.

### 2.5 Compile the data package's asset

Compile the asset at `RELSHA`, in the worktree, from the worktree's copy of
the database. Never copy a compiled asset from the main tree.

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
- The asset's output path is git-ignored, so §2.4's tree is still clean.
  G12 loads this asset, and D1 packs it.

## 3. Prove the gate can fail

A green run proves nothing if the parity replay cannot go red on this
machine with these fixtures. Break the engine in one line, replay, and
revert, all in one block, so no path can resolve into the main tree:

```bash
set -eu; . <release.env>; guard
perl -pi -e 's/^  return lex\.split\(STRIP_LEX_RE\)\[0\] as string;$/  return lex;/' "$REL/src/engine/features.ts"
[ "$(git -C "$REL" status --porcelain)" = " M src/engine/features.ts" ] || { echo "break not isolated" >&2; exit 1; }
(cd "$REL" && npx vitest run tests/parity --reporter=json --outputFile="$OUT/liveness.json") || true
guard; git -C "$REL" checkout -- src/engine/features.ts; [ -z "$(git -C "$REL" status --porcelain)" ]
```

- **Check:** `$OUT/liveness.json` shows assertion failures, not a collection
  or import error, in the analyzer replay and in both generation replays
  (every stem's `lex` is now unstripped, so every lexical analysis and
  every generated form differs). Record the failing-test count.
- The break not applying (the line changed) means this section is stale:
  fix the runbook first. A replay that passes under the break means the
  gate is vacuous: ⛔.
- The data package has no code to break. D3 replays the same fixtures over
  its shipped asset, so this proof covers it too.

## 4. Gate

Run each row in order, in `$REL`, after `guard`; stop at the first failure.
Keep every command's output under `$OUT`. A skipped check is a failed
check. Several tools exit 0 when they skip:

- the parity suites skip, and Vitest exits 0, when the database is absent;
- `check:invariants` passes when `scan_text` was skipped;
- `measure:db`, `parity:asset` and `bench` exit 0 without the database or
  the venv;
- `check:consumer` skips the asset load when the data package's asset is
  absent;
- the charmap test passes when a map is missing.

### `shanisarf`

| Gate | Passes when |
|---|---|
| G1 tree | It runs in the release worktree: not the main tree, on branch `$BRANCH`, with HEAD at `RELSHA` and a clean `git status --porcelain`. |
| G2 static | `npm run typecheck`, and `npm run lint -- --max-warnings=0`. |
| G3 invariants | `SHANISARF_PARITY_PYTHON="$MAIN/tools/parity/.venv/bin/python" npm run check:invariants` exits 0, prints `scan_text:  OK`, and prints no `SKIPPED`. Without the variable, `scan_text` would fall back to a system `python3`. |
| G4 build | `npm run clean && npm run build` exits 0; `check:build` reports every check ok, including that `dist/` holds no source map. |
| G5 tests | `CI=1 npx vitest run --reporter=json --outputFile="$OUT/test.json"` shows `success`, 0 failed tests and suites, 0 pending and 0 todo. The parity replays ran: their test counts are non-zero and the per-fixture case counts in the output match `$OUT/generate.log`. All 21 charmap JSON files are present. |
| G6 asset | `npm run parity:asset` compiles the database and replays every fixture over the asset: it prints that every fixture passed. |
| G7 facts | `npm run measure:db` prints that every table count matched, and its parse time and retained memory are within the threshold of the README's table. |
| G8 performance | `SHANISARF_PARITY_PYTHON="$MAIN/tools/parity/.venv/bin/python" npm run bench` runs to the end (every setup agrees on the analysis counts) and its µs/word rows are within the threshold of the README's table. |
| G9 pack | `npm pack --pack-destination "$OUT" --json > "$OUT/pack.json"` runs exactly once. **Required** in the file list: `package.json`, `README.md`, `LICENSE`, `NOTICE`, `CHANGELOG.md`, `licenses/CAMEL_TOOLS_LICENSE`, `dist/**`. **Forbidden:** anything from `src/`, `tests/`, `tools/`, `fixtures/`, `data/`, `docs/` or `packages/`; `.env`; `.npmrc`; any test file; any `.map`. Packed size at most 300 kB. |
| G10 contents | Checked in the extracted tarball under `$OUT/x`. **Manifest:** R8 holds for the shipped `package.json`, and its `version` is `VER`. **Notices:** every ported engine module's ESM `.js`, CJS `.js` and `.d.ts` carries the `Ported from CAMeL Tools` notice (the files `scripts/check-invariants.mjs` does not exempt). **Names:** `camel` and `calima`, matched case-insensitively, appear in no package name, `exports` key, export name or tarball path other than `licenses/CAMEL_TOOLS_LICENSE`. **Network:** `grep -rlE 'fetch\(|XMLHttpRequest|WebSocket|importScripts' dist` names only the loader's read modules. **README:** it carries the CAMeL Tools copyright line, the Camel Morph CC BY 4.0 attribution with the license URL, and links to `NOTICE` and the license files that resolve on npmjs.com. Its asset URL names `shanisarf-db-msa` at the version in `$PKGDIR/package.json`, its `manifestSha256` example equals `assetDigest` in `$PKGDIR/asset-digest.json`, and it tells users to install `shanisarf-db-msa`. Nothing implies that CAMeL Lab endorses shanisarf. |
| G11 types | In `$OUT/types`, `npx --yes publint --strict "$OUT/$PKG-$VER.tgz"` and `npx --yes @arethetypeswrong/cli --profile node16 "$OUT/$PKG-$VER.tgz"` report nothing for node16-CJS, node16-ESM or bundler, and attw does not say the package has no types. Record the versions npx resolved; they are tools run in a scratch directory, not inputs to the repository. |
| G12 consumer | `npm run check:consumer` passes: it packs the package, installs it offline into scratch consumers by tarball, by `git+file://` at `RELSHA` and by path, and runs an ESM and a CommonJS script in each (imports, analysis, a lexicon lookup, the alignment functions, a worker, and the data package's asset from §2.5). It prints no `skip loadDatabase`. Record the analysis count it prints for the asset. Its tarball is its own; the gated tarball is `$OUT`'s. |

### `shanisarf-db-msa`

| Gate | Passes when |
|---|---|
| D1 pack | `npm pack "$REL/$PKGDIR" --pack-destination "$OUT" --json > "$OUT/db-pack.json"` runs exactly once. The tarball holds `package.json`, `README.md`, `NOTICE`, `asset/manifest.json`, `asset/header.bin` and `asset/stems.bin`, and nothing else. |
| D2 contents | Checked in the extracted tarball under `$OUT/x-db`. **Manifest:** R8 holds for the shipped `package.json`, and its `version` is `DBVER`. **Asset:** the SHA-256 of `asset/manifest.json` equals `assetDigest` in `$PKGDIR/asset-digest.json`; the manifest's `credits`, `license`, `source`, `sourceSha256`, `disclaimer` and `citation` match the root `NOTICE`; no file has the database's SHA-256 or its size of 84,959,404 bytes. **README and `NOTICE`:** they carry the Camel Morph attribution and citation with the CC BY 4.0 license URL, the README's version table has a row for `DBVER`, and its asset URL names `$DBPKG@$DBVER`. Nothing implies that CAMeL Lab endorses shanisarf. |
| D3 replay | In `$REL`, `SHANISARF_PARITY_ASSET="$OUT/x-db/package/asset" npx vitest run tests/parity` replays every fixture over the shipped asset, and every fixture passes with a non-zero case count. |

G11 does not apply to the data package: it ships no JavaScript and no
types.

- Then `chmod a-w "$OUT/$DBPKG-$DBVER.tgz" "$OUT/$PKG-$VER.tgz"`. For each,
  record its `integrity` (sha512), `shasum`, file count, and packed and
  unpacked bytes, from `$OUT/db-pack.json` and `$OUT/pack.json`.

## 5. Dry run

```bash
set -eu; . <release.env>
npm publish "$OUT/$DBPKG-$DBVER.tgz" --dry-run --tag "$TAG" --registry "$REG"
npm publish "$OUT/$PKG-$VER.tgz" --dry-run --tag "$TAG" --registry "$REG"
for t in "$OUT/$DBPKG-$DBVER.tgz" "$OUT/$PKG-$VER.tgz"; do
  echo "$t sha512-$(openssl dgst -sha512 -binary "$t" | base64)"
done
```

- **Check:** each dry run says `Publishing to https://registry.npmjs.org/`
  with tag `$TAG`, then `+ $DBPKG@$DBVER` and `+ $PKG@$VER`.
- **Check:** each computed integrity equals the one recorded in §4.
  Otherwise a tarball changed after the gate: ⛔.
- A dry run does not detect `private: true`; G10 and D2 do. Publishing a
  tarball runs no lifecycle scripts, so the bytes that passed the gate are
  the bytes that are uploaded. Never publish from a directory.

## 6. Hand the publishes to the human

Ask in chat. Give:

- for each package, in publish order: its name, version and tag; the
  tarball's path and `integrity`; the file count and packed size;
- `RELSHA`;
- both gate tables.

Wait for a clear yes. Then give the human this block for **their own
terminal**. It keeps the session token in a throwaway config, out of
`~/.npmrc`, so neither the agent nor any other session runs authenticated:

```bash
U=$(mktemp -d)/npmrc
npm login --registry https://registry.npmjs.org/ --userconfig "$U"
npm whoami --registry https://registry.npmjs.org/ --userconfig "$U"
npm publish "<OUT>/<DBPKG>-<DBVER>.tgz" --tag <TAG> --registry https://registry.npmjs.org/ --userconfig "$U" &&
npm publish "<OUT>/<PKG>-<VER>.tgz" --tag <TAG> --registry https://registry.npmjs.org/ --userconfig "$U"
npm logout --registry https://registry.npmjs.org/ --userconfig "$U"; rm -f "$U"
```

- **Order.** The `&&` runs `shanisarf`'s publish only if the data package's
  succeeded. To publish the data package alone now, leave out the second
  `npm publish` line and the `&&`. `shanisarf`'s gated tarball then waits,
  read-only, and the run resumes at §5 for it (see Resuming).
- **Always log out.** Tell the human to run the last line whether or not
  the publishes succeeded. Before §7, `npm whoami --registry "$REG"` must
  still fail with `ENEEDAUTH` in the agent's shell.
- **2FA** happens in the human's browser, once for each publish.
- **A 403** "too similar to an existing package" is ⛔ for that package.
  If the data package went out and `shanisarf` was refused, the data
  package stays published: run §7 and §8 for it, then plan a new name for
  `shanisarf` with the user.
- **Wait** for the human to report which publishes succeeded; don't poll
  the registry in a loop.

## 7. Verify the registry copies

- **Pending, not a mismatch.** Registry answers, 404s included, are cached
  for up to five minutes. Within about 15 minutes of a publish, an E404, a
  missing version or an old dist-tag means "not visible yet". Check again
  after a few minutes.
- **Then check, for each published package** (`$DBPKG@$DBVER`, then
  `$PKG@$VER`):
  - `npm view "<pkg>@<ver>" dist.integrity --registry "$REG"` equals the
    recorded `integrity`;
  - `npm view "<pkg>" dist-tags --registry "$REG"` shows `$TAG` on its
    version;
  - `npm view "<pkg>" maintainers --registry "$REG"` lists only the
    expected account.
- **Fresh install, both packages together.** In one block:

  ```bash
  set -eu; . <release.env>
  DIGEST=$(node -p "require('$REL/$PKGDIR/asset-digest.json').assetDigest")
  mkdir -p "$OUT/registry" && cd "$OUT/registry" && npm init -y > /dev/null
  npm install --no-audit --no-fund "$DBPKG@$DBVER" "$PKG@$VER" --registry "$REG"
  node --input-type=module -e "import * as m from '$PKG'; import * as w from '$PKG/worker'; console.log(Object.keys(m).sort().join(' ')); console.log(Object.keys(w).sort().join(' '))" > esm.txt
  node -e "const m=require('$PKG'); const w=require('$PKG/worker'); console.log(Object.keys(m).sort().join(' ')); console.log(Object.keys(w).sort().join(' '))" > cjs.txt
  diff esm.txt cjs.txt
  DIGEST="$DIGEST" node --input-type=module -e "import { loadDatabase, Analyzer } from '$PKG'; const db = await loadDatabase(import.meta.resolve('$DBPKG/asset/manifest.json'), { manifestSha256: process.env.DIGEST }); console.log(new Analyzer(db).analyze('كتاب').length)"
  ```

  Each installed `package.json` has its version (`VER`, `DBVER`). The two
  export lists are equal and match the gated tarball's. Each installed
  package's `_integrity` (or `npm ls --json`'s `resolved`/`integrity`)
  equals the recorded `integrity`. The last line loads the registry's
  database with the registry's `shanisarf` and prints the analysis count
  G12 recorded.
- **Only the data package published so far:** install `$DBPKG@$DBVER` alone,
  check its integrity, and check that the SHA-256 of its
  `asset/manifest.json` equals `DIGEST`. The rest waits for `shanisarf`.
- **Account setting:** ask the human to set, for each published package,
  npmjs.com → package → Settings → Publishing access → "Require two-factor
  authentication and disallow tokens", and to confirm when it's done.
- A **confirmed** integrity, tag or maintainer difference: ⛔, and go to
  §Rollback with the human. Once the human has published, a ⛔ here still
  runs §8, with the entry marked `verification failed: <reason>`, because
  every published version must be in the log and tagged.

## 8. Record and tag

- **Log entries.** Append one entry per published package to
  `$REL/docs/releases.md`, the data package's first. Each covers:
  - date, package, version, tag and `RELSHA`;
  - `integrity`, `shasum` and file count;
  - packed and unpacked bytes;
  - who published, and its gate table.

  `shanisarf`'s entry also covers:
  - per fixture, the case count and analysis count from
    `$OUT/generate.log`, and the liveness failure count from §3;
  - Vitest counts, Node, npm, Python, and the database's SHA-256;
  - R4's development-only list (package, license, how it is used);
  - the measured parse, load, memory and µs/word figures.

  The data package's entry also covers the asset digest and D3's
  per-fixture case counts.

  `npm-release.md` reads these entries from `main`.
- **Commit.** First check that `git -C "$REL" status --porcelain` lists
  exactly `docs/releases.md`; anything else means the edit went to the
  wrong tree: ⛔. Then, in one block, `guard` and commit the entries on
  `$BRANCH` as `record release <pkg> <ver>[, <pkg> <ver>]`.
- **Tags.** Tag the published commit, not the record commit, once per
  published package:
  `git -C "$REL" tag -a "$DBGITTAG" "$RELSHA" -m "$DBPKG $DBVER"` and
  `git -C "$REL" tag -a "$GITTAG" "$RELSHA" -m "$PKG $VER"`. Read each back
  with `git rev-parse "<tag>^{commit}"`. A plain `rev-parse` on an annotated
  tag returns the tag object instead.
- **Merge.** Tell the user that `$BRANCH` must be merged into `main`, with
  its history intact, before the next release. That means
  `git merge --no-ff` or a true fast-forward; a squash or rebase merge
  rewrites the commits. `npm-release.md` reads the log from `main`. The
  merge, pushing the branch or tags, and making the GitHub repository public
  are the user's decisions. Ask; don't do them.

## 9. Report

- For each package: name, version and tag; `integrity`.
- `RELSHA`.
- Both gate tables with their evidence, and a summary of what each tarball
  holds.
- The registry checks and the release-log entries.
- What the human still has to do: the 2FA settings, the merge, any push,
  and `shanisarf`'s publish if only the data package went out.
- Any ⛔, with the reason.

## Resuming after a ⛔

- **Same commit.** When the fix needs no new commit (the environment, the
  venv, the database, a user ruling), resume the same run: source the same
  `release.env`, and never re-run the run-state block. If the env path is
  lost, `git -C "$MAIN" worktree list --porcelain` shows `$RUN/rel`, so the
  file is `$RUN/release.env`.
- **New commit, before either package is published.** This run ends. Both
  versions are still free. Ask the user to remove `$REL`
  (`git worktree remove`) and to delete the unpublished `$BRANCH` themselves
  (`git branch -D` is theirs to run). Then start a fresh run state at the
  new `BASE`.
- **Between the two publishes.** The data package is out and `shanisarf`
  is not. The data package's version is spent: run §7 and §8 for it.
  `shanisarf`'s gated tarball stays valid while `RELSHA` is unchanged:
  resume at §5 for it alone, then §6 to §8. If `shanisarf` needs a new
  commit, start a fresh run state at the new `BASE` for `shanisarf` alone,
  leaving out every data-package row and step: its version is spent, and
  its log entry and tag already exist.
- **After both are published,** both versions are spent. Fixes go through
  `npm-release.md`.
- **The gated tarballs are read-only.** Packing a new one needs the user's
  agreement to discard the old one.

## Rollback (human only)

- **A defect:** `npm deprecate "<pkg>@<bad>" "<reason>; use <good>"
  --registry https://registry.npmjs.org/`, then publish a fixed version
  through `npm-release.md`.
- **Bytes that must not be out at all** (a license defect, for example):
  `npm unpublish "<pkg>@<bad>"`.
  - Within 72 hours, this needs only that nothing depends on the package.
    After 72 hours, it also needs fewer than 300 downloads in the last week
    and a single owner.
  - If `<bad>` is the package's only version, which is always true right
    after a first publish, npm refuses without `--force`. Then
    `npm unpublish "<pkg>" --force` removes the whole package.
  - Either way, the version number is burned forever, and mirrors keep
    their copies. Unpublishing every version also blocks the name for
    24 hours.
  - Record any unpublish in the release log, so later version choices skip
    it.
- **Both packages:** roll back only the package with the defect. If both
  must go, roll back `shanisarf` first, so it is never on npm without its
  database.

## Stop conditions (⛔)

- A readiness row fails.
- A login is active when it shouldn't be.
- Another run is in progress.
- The guard fails.
- The venv changes during the run.
- Regeneration fails a guard, or changes a committed file beyond the
  tolerated diff.
- The compiled asset's digest differs from `asset-digest.json`.
- The liveness break won't apply, or the replay passes under it.
- Any gate fails or skips.
- A tarball changes after the gate.
- A dry run doesn't print the expected registry, name, version and tag.
- The registry refuses a name.
- The data package's publish fails: `shanisarf` is not published.
- A confirmed integrity, tag or maintainer difference.
- Anything that would need a credential, OTP or token to pass through the
  agent.
