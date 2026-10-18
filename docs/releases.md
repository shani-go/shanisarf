# Release log

One entry per published version, appended by `npm-first-publish.md` §8 or
`npm-release.md`. Not shipped in the package.

## 2026-10-17 · shanisarf-db-msa 1.0.0

- **Tag** `latest` · **commit** `3900cabb2d6c4a50bf28cda7173df792942f75d3` · git tag `shanisarf-db-msa-v1.0.0`
- **integrity** `sha512-+zc2UEOvFQaYZAbjvia71/+nJq3z5EVE5PGl5MtKodlQHPrtq1VM1jZFLad8Cy2fxgfBmOh/dWnt9XzVMVBf4g==`
- **shasum** `162d22cc81bc7b8699ebba9047ec92a9265f86dd` · 6 files · 6,053,759 B packed · 6,144,592 B unpacked
- **Published by** shanigo, from the gated tarball, in their own terminal with a throwaway npm config; 2FA per publish. Publishing access then set to "Require two-factor authentication and disallow tokens".
- **Asset digest** `7523fca351c45ac82d6a002c4013f393cf0a758b4c08cde8b8f27c2fb54c782e` (equals `asset-digest.json`), compiled at `3900cabb2d6c4a50bf28cda7173df792942f75d3` from the database with SHA-256 `110e03baa282874062d076e23d9671e985b6f76520b891d58cba4e55de0b8f60`.
- **Gate:** D1 pack (exactly the 6 files) · D2 contents (manifest, digest, no raw database, attribution, citation and disclaimer, version row and asset URL) · D3 replay over the shipped asset: 13,362 of 13,362, every fixture non-zero (db-forms 4,794; edge-cases 35 × 10; backoff-nonwords 200 × 5; generator 3,008; reinflector 4,117; word tokenizer 43).
- **Registry check:** integrity, `latest` and maintainers (shanigo only) match; installed together with shanisarf 0.1.0 it loads and analyzes. npm's staged-publishing stub `0.0.0-stage` remains in the version list.

## 2026-10-17 · shanisarf 0.1.0

- **Tag** `latest` · **commit** `3900cabb2d6c4a50bf28cda7173df792942f75d3` · git tag `shanisarf-v0.1.0`
- **integrity** `sha512-hceJEO8yj7y1HZjikLTn5PFKYuBWP7KlnVrZ2ixJP78t6xusbBVxaB41I+vbqakYtA0N2HN+vxofjGNcg9JekQ==`
- **shasum** `9b9441bb139147b2443b101d1f11aeee2ede8423` · 317 files · 219,786 B packed · 1,244,498 B unpacked
- **Published by** shanigo, as above, after shanisarf-db-msa 1.0.0. Publishing access set as above.
- **Toolchain:** Node v26.3.0, npm 11.16.0, Vitest 5.0.3, Python 3.14.5 (matches the fixtures), CAMeL Tools 1.6.0, database SHA-256 `110e03baa282874062d076e23d9671e985b6f76520b891d58cba4e55de0b8f60`.
- **Fixtures** (regenerated at `85b02ca` from the committed harness; nothing under `tools/`, `fixtures/` or `src/` changed after): db-forms.NONE 4,794 cases; edge-cases 35 cases in each of NONE, NOAN_ALL, NOAN_PROP, ADD_ALL and ADD_PROP, strict and not; backoff-nonwords 200 cases in each of the five modes; word tokenizer 43; generator 3,008 cases, 131,351 analyses, 4 errors; reinflector 4,117 cases, 18,559 analyses, 14 errors, 40 referenceRaises. 0 drift. 19 fixtures, 5.94 MB.
- **Liveness (§3):** 532 assertion failures under the break (analyzer 369, generator 48, reinflector 115).
- **Gate:** G1 tree · G2 typecheck and lint, 0 warnings · G3 invariants, `scan_text` with the pinned interpreter · G4 build, 43 checks, notice in all 148 ported outputs · G5 14,109 of 14,109 tests, fixture counts match, 21 charmaps · G6 13,362 replays over the asset · G7 every table count, parse 1.02 s, 98.3 MiB retained · G8 every setup 56,543 analyses · G9 pack, 219.8 kB · G10 contents · G11 publint 0.3.25 clean, attw 0.18.5 green for node16 CJS, node16 ESM and bundler · G12 tarball, git and path consumers, ESM and CJS, 42 analyses of كتاب over the asset.
- **Measured** (Apple M2 Max): parse 1.02–1.09 s; asset load 203 ms (`loadDatabase`), 252 ms (`openAsset`); 98.3 MiB retained after a parse, 100.6 MiB after an asset load; 96 µs/word (`NONE`), 112 µs/word (`NOAN_PROP`) against CAMeL Tools in process 374 / 424; worker 1.64× at 100 words per request; every lexicon index 74 ms, 25.9 MiB.
- **Development-only licenses (R4),** never committed, bundled or distributed: lightningcss and its 11 platform packages (MPL-2.0; npm, via vite); certifi (MPL-2.0; parity venv, via requests); tqdm (MPL-2.0 AND MIT; parity venv); the certifi pip vendors (MPL-2.0).
- **Registry check:** integrity, `latest` and maintainers (shanigo only) match; fresh install's ESM and CJS export lists are equal (96 root, 1 worker) and match the gated tarball; the registry's shanisarf loads the registry's database: 42 analyses of كتاب.
- **Stops and rulings during the run:**
  - 2026-10-17, G8 (first run): bench.mjs could not find the venv in the worktree; fixed on main in fa18bfa (SHANISARF_PARITY_PYTHON), run restarted at BASE fa18bfa.
  - 2026-10-17, G10 (second run): no ported module's .d.ts carried the ported-code notice; fixed on the release branch in 184ae6e (write-dts-notices.mjs, check-build check 11, G9 --ignore-scripts). The user ruled to resume from G1 rather than restart; §2 fixtures, §2.5 asset and §3 liveness were unaffected (no src/, tools/ or fixture change), the ESM and CJS JavaScript was byte-identical to an earlier build of the same sources (tsc is deterministic), so G8 stood, and G5-G7 were re-run.
  - 2026-10-17, G10 names: the user ruled that licenses/CAMEL_MORPH_LICENSE is allowed, like licenses/CAMEL_TOOLS_LICENSE (a verbatim upstream license file); G10's wording is to be fixed on main after the release.
  - 2026-10-17, G11: CommonJS consumers got ESM declarations for all three entry points (attw "Masquerading as ESM", publint). Fixed on the release branch in 3900cab (CJS declarations in dist/cjs, types per import/require condition). The user ruled to resume from G1 again; the ESM and CJS JavaScript stayed byte-identical, so §2, §3 and G6-G8 stand.
