# First npm publish runbook

For an agent. Run top to bottom; every step ends in a check. At any ⛔, stop,
leave everything as it is, and report. Releases are local: no CI, no GitHub
automation, and so no npm provenance (npm generates it only on cloud CI).
The agent prepares and proves; **the human publishes**.

Use this runbook once per package name. Every later version uses
`npm-release.md`, which reuses this runbook's run state, guard, §2–§9,
Resuming section and Rollback.

## What the agent may run

- **npm, read-only or local:** `npm ci`, `npm run …`, `npm test -- <files>`,
  `npm pack`, `npm ls`, and `npm view --registry "$REG"`.
- **npm, only in `$REL`:** `npm version <VER> --no-git-tag-version`.
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

- **Scope.** The `shanisarf` package is everything the package root and its
  `./compile` and `./worker` subpaths export: the engine with the generator
  and reinflector, the loader, the compiler, the worker, the alignment
  functions and the typed-features module. Every parity family ships
  (analyzer, word tokenizer, generator, reinflector), so every fixture is
  replayed. `shanisarf-db-msa` is a separate publish (its section below).
- **Version and tag.** The first version is `0.1.0` on `latest`. Later
  versions follow `npm-release.md` §4. Prereleases go on `next`.
- **Runtime.** `engines.node` is `>=20`. The toolchain is whatever Node and
  npm the gate ran with; the release log records both.
- **Gates.** §4's table. Thresholds: packed tarball at most 300 kB; parse,
  load, memory and µs/word within 1.3× of the README's performance table on
  comparable hardware, otherwise ask. No source maps ship. `fetch` appears
  only in the loader's two read modules (`check:invariants` enforces it).
- **Records.** `CHANGELOG.md` at the repository root, shipped in the
  tarball; the release log at `docs/releases.md`, not shipped.

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
case "$VER" in *-*|*+*) echo "⛔ a first publish needs a stable version" >&2; exit 1;; esac
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
RUN=$RUN
REL=$RUN/rel
OUT=$RUN/out
BRANCH=release/$PKG-v$VER
GITTAG=$PKG-v$VER
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
section, or an entry for `VER`, describing what ships. `docs/releases.md`
exists (empty but for its heading is fine).

**R2. Withdrawn.** Contacting CAMeL Lab is no longer part of the plan. The
number stays so that R3 to R8 keep theirs.

**R3. The `NOTICE` review is done and dated:**

- the Camel Morph rows have been re-read against the `camel_morph` README at
  the pinned commit;
- the CAMeL Tools "What shanisarf takes" list matches the module map in
  `design.md`;
- `LICENSE`, `NOTICE` and `README.md` agree on where the upstream notice
  lives.

**R4. Licenses.** Nothing that enters the build or the tests is GPL, LGPL,
AGPL, MPL, LDC, non-commercial, research-only or of unknown license. This is
the hard stop in `CONTRIBUTING.md`. Check both trees:

- **npm:** walk every `packages` entry of
  `git show "${BASE}:package-lock.json"`, including dev, optional and
  platform packages. A missing `license`, a non-SPDX value, or a legacy
  `licenses` array counts as unknown.
- **Parity venv:** for every `*.dist-info`, read its name, its `License`,
  `License-Expression` and classifiers, and every `License-File` in full.
  Some packages declare their license only through the file.

Expect hits on today's tree: `lightningcss` (MPL-2.0, via vite), `certifi`
(MPL-2.0, via requests) and `tqdm` (`MPL-2.0 AND MIT`). A hit is ⛔. Only
the user can rule on it, in chat. §8 records each ruling in the release
log.

**R5. The parity venv holds exactly the pinned closure.**
`tools/parity/requirements.txt` pins every distribution the analysis path
loads, including requests' dependencies, each with its license line.

```bash
set -eu; . <release.env>
git -C "$MAIN" show "${BASE}:tools/parity/smoke_import.py" > "$RUN/smoke_import.py"
"$MAIN/tools/parity/.venv/bin/python" -I -B "$RUN/smoke_import.py"
"$MAIN/tools/parity/.venv/bin/python" -I -m pip list --format=freeze | sort > "$RUN/venv.freeze"
norm() { sed -E 's/[[:space:]]*#.*//' | grep -E '^[A-Za-z0-9._-]+==' \
  | awk -F'==' '{n=tolower($1); gsub(/[-_.]+/,"-",n); print n"=="$2}' | sort -u; }
git -C "$MAIN" show "${BASE}:tools/parity/requirements.txt" | norm > "$RUN/venv.expect"
norm < "$RUN/venv.freeze" | grep -v '^pip==' | diff "$RUN/venv.expect" - \
  || { echo "⛔ R5: the venv is not the pinned closure" >&2; exit 1; }
! find "$MAIN"/tools/parity/.venv/lib/python3.*/site-packages -maxdepth 2 -name direct_url.json | grep -q .
echo "VENVSUM=$(shasum -a 256 < "$RUN/venv.freeze" | cut -d' ' -f1)" >> "$RUN/release.env"
```

- **Check:** `smoke_import` passes. The venv's distributions, with names
  normalized per PEP 503 (pip prints `camel_tools` where the pin says
  `camel-tools`), equal the pins exactly, apart from `pip` itself. No
  distribution was installed from a direct URL. `VENVSUM` is saved; §2.3
  rechecks it before every regeneration.
- **Rebuilding the venv** is the user's decision. Never run `parity:setup`
  to "fix" it: that runs in the main tree.

**R6. The checks the gate runs exist at `BASE`** and are the ones
`package.json` names: `typecheck`, `lint`, `build` (which ends in
`check:build`), `check:invariants`, `test`, `parity:asset`, `measure:db`,
`bench`, `compile:db` and `check:consumer`. Each is a report-only script
under `scripts/`; none edits a tracked file.

**R7. The name is free.** Run
`npm view "$PKG" name --registry "$REG"`; it gives E404, and so do
`shani-sarf`, `shani_sarf` and `shani.sarf`. The registry also refuses a
name equal to an existing one once punctuation is removed, and it checks
only at publish time, so a dry run cannot prove the name is accepted.

**R8. `package.json` at `BASE` is publishable:**

- no `private`; `license` is `MIT`; `files` includes `dist`, `NOTICE`,
  `licenses` and `CHANGELOG.md`;
- `repository`, `homepage` and `bugs` are set;
- no `dependencies`, `peerDependencies` or `optionalDependencies`;
- no `preinstall`, `install` or `postinstall` script. `prepare` is allowed:
  it builds on a git install and never runs for an installed tarball;
- `publishConfig` is absent, or holds only `access: public`;
- no `camel` or `calima` in the name;
- `version` is below `VER` (§2 bumps it) or equal to it.

If the GitHub repository stays private, the README links nothing that would
404 on npmjs.com.

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
`npm ci` runs `prepare`, which builds `dist/`; §4 rebuilds it from clean.

### 2.1 Version

If `package.json` in `$REL` is below `VER`:

1. In one block: `guard`, then
   `(cd "$REL" && npm version "$VER" --no-git-tag-version)`.
2. Turn the "Unreleased" section of `$REL/CHANGELOG.md` into the entry for
   `VER`, dated.
3. **Check:** `git -C "$REL" status --porcelain` lists exactly
   `package.json`, `package-lock.json` and `CHANGELOG.md`. If it lists
   anything else, or nothing, the edit went to the wrong tree: ⛔.
4. In one block: `guard`, then
   `git -C "$REL" add package.json package-lock.json CHANGELOG.md` and
   `git -C "$REL" commit -m "release $PKG $VER"`.

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

## 4. Gate

Run each row in order, in `$REL`, after `guard`; stop at the first failure.
Keep every command's output under `$OUT`. A skipped check is a failed
check. Several tools exit 0 when they skip:

- the parity suites skip, and Vitest exits 0, when the database is absent;
- `check:invariants` passes when `scan_text` was skipped;
- `measure:db`, `parity:asset` and `bench` exit 0 without the database or
  the venv;
- the charmap test passes when a map is missing.

| Gate | Passes when |
|---|---|
| G1 tree | It runs in the release worktree: not the main tree, on branch `$BRANCH`, with HEAD at `RELSHA` and a clean `git status --porcelain`. |
| G2 static | `npm run typecheck`, and `npm run lint -- --max-warnings=0`. |
| G3 invariants | `npm run check:invariants` exits 0, prints `scan_text:  OK`, and prints no `SKIPPED`. |
| G4 build | `npm run clean && npm run build` exits 0; `check:build` reports every check ok, including that `dist/` holds no source map. |
| G5 tests | `CI=1 npx vitest run --reporter=json --outputFile="$OUT/test.json"` shows `success`, 0 failed tests and suites, 0 pending and 0 todo. The parity replays ran: their test counts are non-zero and the per-fixture case counts in the output match `$OUT/generate.log`. All 21 charmap JSON files are present. |
| G6 asset | `npm run parity:asset` compiles the database and replays every fixture over the asset: it prints that every fixture passed. |
| G7 facts | `npm run measure:db` prints that every table count matched, and its parse time and retained memory are within the threshold of the README's table. |
| G8 performance | `npm run bench` runs to the end (every setup agrees on the analysis counts) and its µs/word rows are within the threshold of the README's table. |
| G9 pack | `npm pack --pack-destination "$OUT" --json > "$OUT/pack.json"` runs exactly once. **Required** in the file list: `package.json`, `README.md`, `LICENSE`, `NOTICE`, `CHANGELOG.md`, `licenses/CAMEL_TOOLS_LICENSE`, `dist/**`. **Forbidden:** anything from `src/`, `tests/`, `tools/`, `fixtures/`, `data/` or `docs/`; `.env`; `.npmrc`; any test file; any `.map`. Packed size at most 300 kB. |
| G10 contents | Checked in the extracted tarball under `$OUT/x`. **Manifest:** R8 holds for the shipped `package.json`, and its `version` is `VER`. **Notices:** every ported engine module's ESM `.js`, CJS `.js` and `.d.ts` carries the `Ported from CAMeL Tools` notice (the files `scripts/check-invariants.mjs` does not exempt). **Names:** `camel` and `calima`, matched case-insensitively, appear in no package name, `exports` key, export name or tarball path other than `licenses/CAMEL_TOOLS_LICENSE`. **Network:** `grep -rlE 'fetch\(|XMLHttpRequest|WebSocket|importScripts' dist` names only the loader's read modules. **README:** it carries the CAMeL Tools copyright line, the Camel Morph CC BY 4.0 attribution with the license URL, and links to `NOTICE` and the license files that resolve on npmjs.com. Nothing implies that CAMeL Lab endorses shanisarf. |
| G11 types | In `$OUT/types`, `npx --yes publint --strict "$OUT/$PKG-$VER.tgz"` and `npx --yes @arethetypeswrong/cli --profile node16 "$OUT/$PKG-$VER.tgz"` report nothing for node16-CJS, node16-ESM or bundler, and attw does not say the package has no types. Record the versions npx resolved; they are tools run in a scratch directory, not inputs to the repository. |
| G12 consumer | `npm run check:consumer` passes: it packs the package, installs it offline into scratch consumers by tarball, by `git+file://` at `RELSHA` and by path, and runs an ESM and a CommonJS script in each (imports, analysis, a lexicon lookup, the alignment functions, a worker, and the data package's asset). Its tarball is its own; the gated tarball is `$OUT`'s. |

- Then `chmod a-w "$OUT/$PKG-$VER.tgz"`. Record its `integrity` (sha512),
  `shasum`, file count, and packed and unpacked bytes, all from
  `$OUT/pack.json`.

## 5. Dry run

```bash
set -eu; . <release.env>
npm publish "$OUT/$PKG-$VER.tgz" --dry-run --tag "$TAG" --registry "$REG"
echo "sha512-$(openssl dgst -sha512 -binary "$OUT/$PKG-$VER.tgz" | base64)"
```

- **Check:** the output says `Publishing to https://registry.npmjs.org/`
  with tag `$TAG`, then `+ $PKG@$VER`.
- **Check:** the computed integrity equals the one recorded in §4.
  Otherwise the tarball changed after the gate: ⛔.
- A dry run does not detect `private: true`; G10 does. Publishing a tarball
  runs no lifecycle scripts, so the bytes that passed the gate are the bytes
  that are uploaded. Never publish from the directory.

## 6. Hand the publish to the human

Ask in chat. Give:

- the package, version and tag;
- the tarball's path and `integrity`;
- the file count and packed size;
- `RELSHA`;
- the gate table.

Wait for a clear yes. Then give the human this block for **their own
terminal**. It keeps the session token in a throwaway config, out of
`~/.npmrc`, so neither the agent nor any other session runs authenticated:

```bash
U=$(mktemp -d)/npmrc
npm login --registry https://registry.npmjs.org/ --userconfig "$U"
npm whoami --registry https://registry.npmjs.org/ --userconfig "$U"
npm publish "<OUT>/<PKG>-<VER>.tgz" --tag <TAG> --registry https://registry.npmjs.org/ --userconfig "$U"
npm logout --registry https://registry.npmjs.org/ --userconfig "$U"; rm -f "$U"
```

- **Always log out.** Tell the human to run the last line whether or not
  the publish succeeded. Before §7, `npm whoami --registry "$REG"` must
  still fail with `ENEEDAUTH` in the agent's shell.
- **2FA** happens in the human's browser.
- **A 403** "too similar to an existing package" is ⛔. Plan a new name
  with the user.
- **Wait** for the human to report back; don't poll the registry in a loop.

## 7. Verify the registry copy

- **Pending, not a mismatch.** Registry answers, 404s included, are cached
  for up to five minutes. Within about 15 minutes of the publish, an E404,
  a missing version or an old dist-tag means "not visible yet". Check again
  after a few minutes.
- **Then check:**
  - `npm view "$PKG@$VER" dist.integrity --registry "$REG"` equals the
    recorded `integrity`;
  - `npm view "$PKG" dist-tags --registry "$REG"` shows `$TAG` on `VER`;
  - `npm view "$PKG" maintainers --registry "$REG"` lists only the expected
    account.
- **Fresh install.** In one block:

  ```bash
  set -eu; . <release.env>
  mkdir -p "$OUT/registry" && cd "$OUT/registry" && npm init -y > /dev/null
  npm install --no-audit --no-fund "$PKG@$VER" --registry "$REG"
  node --input-type=module -e "import * as m from '$PKG'; import * as w from '$PKG/worker'; console.log(Object.keys(m).sort().join(' ')); console.log(Object.keys(w).sort().join(' '))" > esm.txt
  node -e "const m=require('$PKG'); const w=require('$PKG/worker'); console.log(Object.keys(m).sort().join(' ')); console.log(Object.keys(w).sort().join(' '))" > cjs.txt
  diff esm.txt cjs.txt
  ```

  The installed `package.json` has `version` `VER`, the two export lists are
  equal and match the gated tarball's, and the installed package's
  `_integrity` (or `npm ls --json`'s `resolved`/`integrity`) equals the
  recorded `integrity`.
- **Account setting:** ask the human to set npmjs.com → package → Settings
  → Publishing access → "Require two-factor authentication and disallow
  tokens", and to confirm when it's done.
- A **confirmed** integrity, tag or maintainer difference: ⛔, and go to
  §Rollback with the human. Once the human has published, a ⛔ here still
  runs §8, with the entry marked `verification failed: <reason>`, because
  every published version must be in the log and tagged.

## 8. Record and tag

- **Log entry.** Append an entry to `$REL/docs/releases.md` covering:
  - date, package, version, tag and `RELSHA`;
  - `integrity`, `shasum` and file count;
  - packed and unpacked bytes;
  - per fixture, the case count and analysis count from
    `$OUT/generate.log`, and the liveness failure count from §3;
  - Vitest counts, Node, npm, Python, and the database's SHA-256;
  - every R4 ruling (package, license, the user's words, date);
  - the measured parse, load, memory and µs/word figures;
  - who published, and the gate table.

  `npm-release.md` reads this entry from `main`.
- **Commit.** First check that `git -C "$REL" status --porcelain` lists
  exactly `docs/releases.md`; anything else means the edit went to the
  wrong tree: ⛔. Then, in one block, `guard` and commit the entry on
  `$BRANCH` as `record release $PKG $VER`.
- **Tag.** Tag the published commit, not the record commit:
  `git -C "$REL" tag -a "$GITTAG" "$RELSHA" -m "$PKG $VER"`. Read it back
  with `git rev-parse "$GITTAG^{commit}"`. A plain `rev-parse` on an
  annotated tag returns the tag object instead.
- **Merge.** Tell the user that `$BRANCH` must be merged into `main`, with
  its history intact, before the next release. That means
  `git merge --no-ff` or a true fast-forward; a squash or rebase merge
  rewrites the commits. `npm-release.md` reads the log from `main`. The
  merge, pushing the branch or tag, and making the GitHub repository public
  are the user's decisions. Ask; don't do them.

## 9. Report

- Package, version and tag; `RELSHA`; `integrity`.
- The gate table with its evidence, and a summary of what the tarball holds.
- The registry check and the release-log entry.
- What the human still has to do: the 2FA setting, the merge, any push.
- Any ⛔, with the reason.

## Resuming after a ⛔

- **Same commit.** When the fix needs no new commit (the environment, the
  venv, the database, a user ruling), resume the same run: source the same
  `release.env`, and never re-run the run-state block. If the env path is
  lost, `git -C "$MAIN" worktree list --porcelain` shows `$RUN/rel`, so the
  file is `$RUN/release.env`.
- **New commit, before the human has published.** This run ends. `VER` is
  still free. Ask the user to remove `$REL` (`git worktree remove`) and to
  delete the unpublished `$BRANCH` themselves (`git branch -D` is theirs to
  run). Then start a fresh run state at the new `BASE`.
- **After the human has published,** the version is spent. Fixes go through
  `npm-release.md`.
- **The gated tarball is read-only.** Packing a new one needs the user's
  agreement to discard the old one.

## The data package (`shanisarf-db-msa`)

`design.md` describes the asset; the package directory `PKGDIR` is
`packages/shanisarf-db-msa`. Add `PKGDIR=packages/shanisarf-db-msa` to
`release.env`. Then:

- **R3** covers the database's license. `NOTICE` reads the compiled `.db`
  files as data under the `camel_morph` README's CC BY 4.0 statement, and
  R3's review checks that the reading still holds at the pinned commit.
- **R8** reads `${BASE}:${PKGDIR}/package.json`. `license` is `CC-BY-4.0`
  (the package ships no JavaScript). The version is
  `<database major>.<database minor>.<release>`, so Camel Morph MSA 1.0
  gives `1.0.0`, `1.0.1`, …, and a new asset format version is a new
  patch. `private: true` comes off in the release worktree only. `GITTAG`
  and `BRANCH` already carry the package name.
- **§2:** after `RELSHA`, `guard`, then build the compiler at `RELSHA`
  (`npm run build` in `$REL`) and compile
  `$REL/data/camel-morph-msa/msa-v1.0.db` into the package with
  `npm run compile:db -- --verify --out "$REL/$PKGDIR/asset"` (run in
  `$REL`). The asset's output path is git-ignored, so §2.4 and G1 still see
  a clean tree. Never copy a compiled asset from the main tree. The asset
  digest, the SHA-256 of the compiled `manifest.json`, equals the committed
  expected digest in `$PKGDIR/asset-digest.json`, which changes only in a
  reviewed commit that says why. `--verify` exits 1 on any difference,
  lists it, and exits 2 without the database, so the gate cannot pass by
  not running.
- **§2.1:** bump the version in `$REL/$PKGDIR`, never at the root.
- **§3** is the root package's; the data package has no code to break.
- **§4:** G1 to G8 are the root package's run. G9 and §5 pack
  `"$REL/$PKGDIR"` explicitly; the tarball holds `package.json`, the README
  carrying the attribution, the `NOTICE`, `asset/manifest.json`,
  `asset/header.bin` and `asset/stems.bin`, and nothing else. G10 checks
  the manifest's `credits`, `license`, `source`, `sourceSha256`,
  `disclaimer` and `citation` against `NOTICE`, and that no file has the
  database's SHA-256 or its size of 84,959,404 bytes. G11 does not apply.
  G12 is `parity:asset` pointed at the extracted tarball: in `$REL`,
  `SHANISARF_PARITY_ASSET="$OUT/x-db/package/asset" npx vitest run tests/parity`
  replays every fixture over the shipped asset, and every fixture passes.
- **Publishing:** each package is its own publish, with its own 2FA
  challenge.

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

## Stop conditions (⛔)

- A readiness row fails.
- A login is active when it shouldn't be.
- Another run is in progress.
- The guard fails.
- The venv changes during the run.
- Regeneration fails a guard, or changes a committed file beyond the
  tolerated diff.
- The liveness break won't apply, or the replay passes under it.
- Any gate fails or skips.
- The tarball changes after the gate.
- The dry run doesn't print the expected registry, name, version and tag.
- The registry refuses the name.
- A confirmed integrity, tag or maintainer difference.
- Anything that would need a credential, OTP or token to pass through the
  agent.
