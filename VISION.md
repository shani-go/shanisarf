# shanisarf: vision & ethos

This is the **why** of shanisarf: what it is for and the principles the work
is held to. [`docs/design.md`](docs/design.md) says how it is built;
[`CONTRIBUTING.md`](CONTRIBUTING.md) is the enforced form of the rules below.
On questions of principle, this document governs.

## What shanisarf is

shanisarf is an Arabic morphological analyzer for JavaScript: given a word, it
returns every analysis the word admits (clitics, stem, lemma, root, pattern,
part of speech and features, diacritized form, transliterations), and it
does so **offline, in any JavaScript runtime, under permissive terms**. It
is a faithful port of the analysis core of
[CAMeL Tools](https://github.com/CAMeL-Lab/camel_tools) (MIT) running over the
[Camel Morph MSA](https://github.com/CAMeL-Lab/camel_morph) database
(CC BY 4.0), compiled into a compact asset.

### The name

shanisarf is named for the developer's dog Shani, a brindle-coated Jindo:
gentle, wise, and aloof. **ṣarf** (صَرْف) is the Arabic name for morphology
itself, *ʿilm aṣ-ṣarf*, the science of how words inflect and derive from
their roots. So shanisarf is "Shani's morphology".

## Principles

- **Faithful first, clever later.** The engine returns what CAMeL Tools
  returns over the same database, proven by fixtures generated from the
  Python implementation. Output-changing improvements come after parity and
  are off by default.
- **Permissive end to end.** The project exists because the alternatives are
  copyleft or remote. Code is MIT, and no code under another license enters
  the repository, the build or the tests, even for reference. CC BY-SA
  material is consulted and cited, never committed or packaged, because
  share-alike would attach to whatever bundles it. Test words come from the
  database, from permissive word lists, or are invented. Nothing is added on
  top of MIT and CC BY that asks what a user is building.
- **Content stays on the device.** Analysis is a pure function of the word
  and the loaded database. Loading is the caller's explicit, integrity-checked
  act; there is no telemetry and no remote cache.
- **Honest output.** Features are reported as the database states them. A
  word the database cannot analyze is reported as such, with the backoff
  applied, never dropped or guessed. Engine and database versions travel with
  results.
- **Independent and small.** No runtime dependencies, one job. Dialect
  identification, named entities, sentiment and neural disambiguation are out
  of scope unless they can be separate, optional, equally permissive entry
  points, after the core is done. Any ALMOR-format database CAMeL Tools reads
  loads here too.
- **Respect upstream.** CAMeL Lab is credited prominently, the port is open
  about what it is, and their names ("CAMeL", "CALIMA") stay out of its own.
  If CAMeL Lab asks, shanisarf retracts its published packages and makes the
  repository private again.
- **Explainable, not opaque.** Every analysis traces to a prefix, a stem and a
  suffix entry and three compatibility-table rows. A neural component, if one
  is ever added, is optional, labelled by name and type, and never replaces
  the inspectable path.

## Hard invariants

These hold on every commit, without exception:

1. **License range.** Code: MIT-derived only. Committed data and text: public
   domain, CC0, or CC BY only, each with a `NOTICE` row. CC BY-SA: cite and
   consult, never commit or package anything derived from it. No GPL, LGPL,
   AGPL, MPL, LDC, research-only or non-commercial material anywhere in the
   repository or the build.
2. **No copyrighted running text.** Not a line, in any file.
3. **No network at analysis time.** Database loading is the caller's explicit
   act; nothing else touches the network.
4. **No hardcoded secrets.** There should be none to hard-code; anything
   configurable is read from the environment and fails closed when missing.
5. **Parity before change.** Output-changing work lands behind a default-off
   option until the fixtures say otherwise.
6. **Attribution travels.** `NOTICE` names every upstream; compiled assets
   carry their attribution and license in their manifest.

## Scope

shanisarf is analysis, generation and reinflection at parity with CAMeL
Tools 1.6 over Camel Morph MSA v1.0; a compiled, integrity-checked asset
with browser, Node and worker entry points; lexicon lookups; alignment of an
analysis with the word as written; and a demo page. Not included, by
design: a CLI, out-of-context ranking, the morphological tokenizer,
in-context disambiguation and the Camel Morph EGY database.
[`docs/design.md`](docs/design.md) gives the reasons.

## License

shanisarf's code is **MIT**, a transformation of CAMeL Tools' MIT code; see
[`LICENSE`](LICENSE) and [`NOTICE`](NOTICE). Compiled database assets carry
the Camel Morph data license, **CC BY 4.0**, with attribution. Fixture word
lists are public domain, CC0 or CC BY, recorded per list in `NOTICE`.
Nothing in this project is proprietary, and nothing restricts personal,
educational, research or commercial use.

One stance is stated as a **request, not a license term**, so the code
stays OSI-open: the developer asks that this repository not be used to train
or improve machine-learning models. It is not formalized; it is repeated in
the README so that it is seen.
