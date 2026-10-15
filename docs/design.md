# shanisarf: design

How the code is built and why it is built that way. The README says how to
use it; `NOTICE` says what is owed to whom; `CONTRIBUTING.md` says the rules
a change must keep. This document explains what is there.

## Glossary

- **Upstream**: CAMeL Tools 1.6.0, the Python implementation the engine
  reproduces, pinned on the `--no-deps` install line in
  `scripts/parity.mjs` (`tools/parity/requirements.txt` pins its
  analysis-path dependencies).
- **The pin**: the Camel Morph MSA v1.0 database, commit `15f5aede`, SHA-256
  `110e03ba…0b8f60`, 84,959,404 bytes, fetched by `tools/parity/fetch_db.py`
  into the git-ignored `data/`.
- **ALMOR text**: the database format upstream reads: the sections
  `###DEFINES###`, `###DEFAULTS###`, `###ORDER###`, `###TOKENIZATIONS###`,
  `###STEMBACKOFF###`, `###PREFIXES###`, `###SUFFIXES###`, `###STEMS###`,
  `###TABLE AB###`, `###TABLE BC###`, `###TABLE AC###`, in that order.
- **Entry**: one affix or stem line: a surface, a category and a feature
  dictionary. **Analysis**: one reading of a word, a plain object from
  feature name to string, number (the three log-probabilities) or `null`.
- **Canonical key**: the compact JSON of an analysis with sorted keys, used
  to sort and compare analyses. **Canonical order**: analyses sorted by it,
  duplicates kept.
- **Fixture**: a gzipped JSON file of upstream's output for one word list
  under one analyzer configuration. **Word list**: a committed, reviewed
  list of words with a `NOTICE` row. **Request list**: the same for
  generation and reinflection requests.
- **Asset**: a compiled database: a manifest and the two shards it names.
  **Asset digest**: the SHA-256 of the manifest's bytes.
- **Retained memory**: in Node, `heapUsed + external` after the source
  string is dropped and `gc()` runs twice.

## The port

### Rules

The engine is a line-for-line translation of upstream with these systematic
changes, applied everywhere and nowhere else:

1. **Code points, not code units.** Wherever upstream indexes, slices,
   measures or iterates a string, the port works on code points. Arabic is
   BMP-only, but the punctuation and backoff paths see emoji and other
   astral characters, and segmentation over them must match Python's.
2. **Python string semantics, explicitly.** `strip()`, `split()`,
   `split(' ')`, universal newlines and `re.sub` are each a named helper in
   `python-compat.ts` with the Python definition. The engine never uses
   `trim`, `split(/\s/)`, `\s` or `\d`; an ESLint rule enforces this under
   `src/engine/`.
3. **Regular expressions translated one by one**, always with the `u` flag,
   never rewritten "equivalently". `\d` becomes `\p{Nd}` because upstream
   uses the Unicode-aware `regex` module. Unicode categories come from the
   host's `\p{P}`, `\p{S}`, `\p{Nd}` and emoji properties; no Unicode-derived
   table is committed. Two corners are outside parity and outside every
   word list: words containing a line terminator, and emoji sequences
   outside the UTS #51 pattern.
4. **Errors where upstream raises; defined results where upstream would
   crash.** The typed errors are ported with upstream's messages (Python
   `repr` included). Where upstream would raise a `KeyError` or `IndexError`
   that no caller handles, the port returns an empty set or a parse error,
   with a comment at the site naming the upstream line. None of these cases
   occurs on the pin.
5. **Same output, same order.** The restructured engine produces, for every
   call, results whose `Object.entries` equal the line-for-line port's, in
   the same order. The canonical key is a comparison device; no engine code
   sorts keys or results. Enumeration order is upstream's (segmentation
   order, then prefix entry, stem entry, suffix entry; lexical analyses
   before backoff), so `analyze` matches upstream even by index.
6. **The model is immutable after construction.** Everything derived from it
   (the merge plan, bitsets, indexes) is built once.
7. **The engine does no I/O.** Bytes, files, URLs, compression and hashes
   live in `src/load/` and `src/compile/`. The engine entry exports no
   loader.
8. **Verify, then trust.** The loader hashes every shard and validates every
   section's structure before any part of the model is built.
9. **Requests stay where the caller points.** The loader requests only the
   manifest and the shards it names, each resolved under the caller's
   source. A shard path is a bare file name, so a manifest cannot send the
   loader elsewhere.
10. **Nothing new on the analysis path.** The lexicon reads the model and
    the alignment functions read an analysis; the engine calls neither.
11. **Alignment never chooses.** `cliticSegments`, `placeMarks` and
    `agreedMarks` are pure functions of the caller's word and the analyses
    the caller passes. They rank nothing and return `null` rather than a
    forced result.

### Module map

Modules are named for what they do, never for the upstream file. Each ported
file carries the ported-code notice (see `CONTRIBUTING.md`); the files marked
new design carry the project header only.

| Upstream | Port | Notes |
|---|---|---|
| `utils/charsets.py` | `src/engine/charsets.ts` | the five encodings' letter and diacritic sets; Unicode category sets become regex classes |
| `utils/charmap.py`, `utils/charmaps/*.json` | `charmap.ts`, `charmaps/<name>.ts` | `CharMapper` with range keys; the twenty-one maps are generated from the upstream JSON by `tools/gen-charmaps.ts` |
| `utils/dediac.py` | `dediac.ts` | |
| `utils/normalize.py` | `normalize.ts` | |
| `utils/transliterate.py` | `transliterator.ts` | |
| `utils/stringutils.py` | `python-compat.ts` | new design: the Python string helpers |
| `morphology/database.py` | `database.ts`, `almor-parser.ts` | the model and the parser, analysis and generation sides |
| `morphology/utils.py` | `features.ts`, `tuple-merge.ts` | `stripLex`, `simpleArToCaphi`, the rewrite rules; `merge_features` as the tuple merge |
| `morphology/analyzer.py` | `analyzer.ts`, `segments.ts` | |
| `morphology/generator.py` | `generator.ts` | |
| `morphology/reinflector.py` | `reinflector.ts` | |
| `morphology/errors.py` | `errors.ts` | analysis and generation error classes |
| `tokenizers/word.py` | `word-tokenizer.ts` | `simpleWordTokenize` |
| none | `almor-serializer.ts` | new design: writes a model back to ALMOR text, for round-trip tests |
| none | `string-table.ts`, `feature-schema.ts`, `compat-bitset.ts`, `model-views.ts` | new design: the tuple model |
| none | `lfu-cache.ts` | new design: the analysis cache |
| none | `model-codec.ts` | new design: the model as sections and back |
| none | `lexicon.ts`, `key-fold.ts` | new design: lookups over the stem table |
| none | `src/load/`, `src/compile/`, `src/worker/`, `src/align/`, `src/msa-features.ts` | new design throughout |

Out of scope and not ported: upstream's built-in database loading and
`camel_data`, the MLE and BERT disambiguators, the morphological tokenizer,
dialect identification, named entities, sentiment, and the CLI. The
Camel Morph EGY database is not an ALMOR database upstream 1.6.0 reads (it
carries a `###POSTREGEX###` section), so it does not load here either.

### Analysis

`analyze(word)` follows upstream's branches in upstream's order:

```
word ──strip──▶ '' ? ──▶ []
   ├─ cache hit on the stripped word? ──▶ the stored array
   ├─ wordDediac = dediacAr(word); wordNormal = normMap(wordDediac)
   ├─ digit?    (strict: all digits; else: contains one)      ──▶ [digit result]
   ├─ punc?     (all punctuation or symbols)                  ──▶ [punc result]
   ├─ hasPunc?  (some punctuation)                            ──▶ no lexical lookup
   ├─ !isAr?    (not all Arabic letters)                      ──▶ [foreign result]
   └─ lexical: for (prefix, stem, suffix) of segments(wordNormal, maxPrefix, maxSuffix):
        prefix and suffix surfaces both present, stem surface present
          ──▶ for each prefix entry, stem entry, suffix entry compatible under AB, BC and AC:
                merge the three feature dictionaries ──▶ one analysis
   then, if (NOAN mode and nothing so far) or ADD mode:
        the same segmentation with the NOAN stems of the backoff action,
        the stem surface substituted into bw, diac and lex, caphi recomputed
```

The special-path results (`digit`, `punc`, `foreign`) are built from the
`DEFAULTS` rows. The five backoff modes are `NONE`, `NOAN_ALL`, `NOAN_PROP`,
`ADD_ALL` and `ADD_PROP`: the condition (`NOAN`: only when no lexical
analysis; `ADD`: always) and the action (`ALL` or `PROP`, the stem
categories `STEMBACKOFF` names). `normMap` is `undefined` for upstream's
default map or `null` for none; upstream cannot express "none", so that
branch is default-off and parity-neutral.

Segmentation is pruned: the prefix slots of every prefix length and the
suffix slots of every suffix length are looked up once each, and only
(prefix, suffix) pairs whose surfaces both exist are enumerated. The visited
triples and their order are exactly those the plain enumeration yields with
both affixes present.

### The model

`MorphologyDb` exposes upstream's tables as read-only `Map`s and `Set`s
(`prefixes`, `suffixes`, `stems`, the three compatibility tables, `defines`,
`defaults`, `order`, `tokenizations`, `computeFeats`, `stemBackoffs`; with
generation, `prefixCatHash`, `suffixCatHash`, `lemmaHash`,
`stemPrefixCompat`). Behind them is a tuple model:

- a **string table** of every distinct string (feature names and values,
  categories, surfaces), indexed by string id; the strings seen before
  `###STEMS###` come first, so the model splits into a **header part** and
  a **stem part**;
- a **layout** per distinct key list, in the order a line first states its
  keys; each entry is its category, its layout and a **tuple** of value
  string ids aligned with the layout;
- entries stored in **line order**, with compressed-sparse-row indexes per
  surface, per lemma and per category, so both the analyzer's per-surface
  order and the serializer's line order come from one table;
- the compatibility tables as **bitsets** over role-local category ids,
  beside line-ordered pair lists for the generation side;
- a **merge plan**: the precomputed feature-id lists for the merge steps
  that consult `defines` or `computeFeats`.

The `Map` fields are **views** that materialize frozen `Entry` objects on
access and memoize them per model, so test and tool code that reads the
tables works and sharing is observable. The engine itself reads the tuples.
Parsing interns from ranges of the source text and copies every string, so
the parsed model retains none of the 85 MB source.

The **merge** (`tuple-merge.ts`) mirrors upstream's `merge_features` step
by step over tuples: the prefix and suffix dictionaries overlay the stem's,
the `*` defaults are resolved, the computed features (`bw`, `diac`, `lex`,
the clitic features, `caphi`, `pattern`, the transliterations) are built by
upstream's rules and regular expressions, the three log-probabilities become
numbers, and the result's key order is a function of the stem's layout, the
path and the plan, plus one conditional trailing key. The dictionary form of
the merge is gone from the engine; the fixtures and the key-order snapshot
test hold the tuple form to upstream's output.

The **cache** (`lfu-cache.ts`) is an O(1) least-frequently-used cache keyed
by the stripped word, off by default as upstream's is. Its tie-break evicts
the earliest entry into the lowest-count bucket. A hit returns the stored
array, as upstream does, so callers copy before mutating. The README gives
the measured hit rate and cost per cached word.

### Generation

`Generator.generate(lemma, feats)` and `Reinflector.reinflect(word, feats)`
need a model parsed or loaded with flags `g` or `r`. They read the lemma and
category indexes and the transposed AB pairs, and use the same merge. Where
upstream raises a `KeyError` for a stem lacking a requested `vox`, `rat` or
`pos` (66,432 stems of the pin lack `rat`), the port skips the stem: absent
counts as different. The generation fixtures record those cases as
`referenceRaises` and take their expected output from upstream run over a
copy of the database whose stems answer the missing feature with a sentinel
equal to nothing. The port's output order is defined (table-line order,
first occurrence kept) where upstream's depends on the Python hash seed;
comparison is canonical, and the reinflector's dedup key is the ordered
entries, as upstream's is, so two results equal as dictionaries but in
different key order both survive.

### The worker

`shanisarf/worker` runs an analyzer in a Web Worker or under
`worker_threads` behind one promise API. The host (`serve.ts`) imports only
engine and loader modules and makes no request; its data arrives in
messages. The client (`client.ts`, `connect.ts`) starts the worker script
next to itself, or the `Worker` or URL the caller supplies.

Every request carries an `id` and every reply echoes it, so calls overlap.
The operations are `init`, `analyze`, `analyzeWords`, `generate`,
`reinflect`, `lookup`, `allFeats` and `tokFeats`. A source is ALMOR text,
its UTF-8 bytes (decoded with `ignoreBOM: true`, not fatal, as Node's
`readFileSync` decodes), or an asset the caller's thread has read with
`readAsset` and transfers; the host opens it with `openAsset`, so the
integrity check runs in the worker and the main thread never parses. A
`CharMapper` cannot cross structured clone, so `normMap` crosses as
`'default'`, `null` or a `CharMap` spec rebuilt in the worker. The
generator, reinflector and lexicon are built lazily in the worker on first
use, so their constructor errors reach the caller from that call.

Results cross by structured clone, which keeps key order and values, so a
result in the caller has the same `Object.entries` as in the worker. Errors
cross as `{ name, message, fields }` and are rebuilt by name from a registry
of the exported classes with `Reflect.construct`, so `instanceof` holds and
the fields are restored. An encoded result table (key lists and strings
once, values in typed arrays) was measured and not taken: it saved little
and slowed one-word requests. `entries()` of the lexicon does not cross;
`lookup` does, with `features` to keep the reply small.

### The asset

A compiled database is a `manifest.json` and two shards, `header.bin` and
`stems.bin`, holding the header part and the stem part. Format version 1.

**Manifest.** Canonical JSON (fixed key order, two-space indent, trailing
newline): `format: "shanisarf-asset"`, `formatVersion: 1`, the source
record's descriptive fields (`id`, `name`, `version`, `license`, `credits`,
`disclaimer`, `citation`, `source`, `sourceSha256`, `sourceBytes`), the
model's `counts`, and per shard its `part`, `path`, `compression`
(`deflate`), `size` and `sha256`. `size` and `sha256` are of the shard's
**inflated** content, so the manifest, and hence the asset digest, does not
depend on the zlib build or level: any machine compiling the same input
gets the same digest, which is why `asset-digest.json` can be committed and
checked. The manifest records no engine or compiler version: the digest
changes when the content changes, not with every release. The loader
validates every field, requires exactly one `header` and one `stems` shard,
and accepts a `path` only if it matches `^[A-Za-z0-9][A-Za-z0-9._-]*$` and
is not `manifest.json`.

**Container.** Each shard inflates to a fixed preamble (magic, format
version), a JSON directory and the sections at 8-byte-aligned offsets. A
section is one typed array of one part with its name, element type (`u8`,
`u16` or `u32`; `u16` when the largest id fits, recorded in the directory),
length and filter. The filters are reversible transforms chosen because the
arrays are mostly small integers in wide cells: `none`, `shuffle` (byte
planes) and `delta-shuffle`; they cut the compressed size from about 10.2
to 6.7 MB for about 70 ms at load. The directory also holds the part's
metadata: flags, defines, defaults, order, tokenizations, computed
features, stem backoffs, the feature name list, the header string count,
the string encoding and the table counts.

Only what cannot be derived is stored. The dense rows, the bitsets, the
category indexes, the lemma index and the maximum affix sizes are rebuilt
at load from the stored sections, so a hand-made or mis-compiled asset
cannot carry a copy that disagrees with its source. AB transposed is stored
because its row order is the `TABLE AB` lines' first-seen stem order, which
the pair list does not keep. One asset carries every table, and the load
flags (`a`, `g`, `r`) select which to build.

**Integrity.** `openAsset` inflates each shard (through
`DecompressionStream('deflate')` in browsers, `node:zlib` with a capped
output length in Node), checks its length and SHA-256 against the manifest
(`crypto.subtle`, with a pure JavaScript fallback for pages without it),
reads the container, validates every section's type, length and range, and
only then decodes the model. With `manifestSha256`, the manifest itself is
checked first, so a tampered manifest is refused before any shard is read.
The check is never skipped. Big-endian hosts are refused: sections are
stored little-endian and never swapped, and no test can run there.

`compileDatabase` is the reverse: parse with `r`, encode each part, write
the containers through their filters, hash the inflated content, deflate at
level 9, write the manifest. The deflate format was chosen over gzip (whose
header varies by machine and which servers may undo) and Brotli (no
universal `DecompressionStream` format). Brotli would save about a further
30%.

**Provenance.** A loaded database carries the manifest's descriptive fields
as `db.provenance`, and a worker analyzer opened from an asset carries the
same. Attribution rides on the database, not on each analysis, so results
are unchanged.

### The lexicon and alignment

`Lexicon` answers `byLemma`, `byStem`, `byRoot`, `lookup` and `entries()`
over the stem table without the views, returning fresh frozen records in
layout order (or the caller's `features` subset in that order). It requires
a model with analysis (`a` or `r`): a generation-only model has no stem
surfaces, and 19 of the pin's surfaces are not the fold of their `diac`, so
surfaces cannot be rebuilt by rule. The stem index is the model's own; the
lemma index is the model's under `r` and built from `lex` under `a`; the
root index is built from `root`. Folded indexes map each folded key to the
unfolded slots. Indexes are built on first use and held on the `Lexicon`,
so the model is unchanged and dropping the lexicon frees them. The lemma
key is the stored `lex`, which the parser passes through `stripLex` as
upstream does, so an analysis's `lex` and `byLemma`'s argument are the same
string.

`foldArabicKey` is `dediacAr` then the default normalization map: it removes
the diacritics and the tatweel, writes the alef variants bare, alef maksura
as yaa and teh marbuta as haa. It is exactly what the default analyzer does
to its input before the lexical lookup, so for every lexical analysis the
word's letters and the analysis's letters agree under it.

`cliticSegments(word, analysis, { scheme })` reads the segmentation feature
(`d3seg` by default): `x+` pieces are proclitics, `+x` enclitics, the one
remaining piece the stem. The word's letters (every code point that is not
an Arabic diacritic or the tatweel), folded, must equal the pieces' letters
in order; then the word is cut so that each segment takes its letters and
every mark or tatweel that follows its last letter. The texts are slices of
the word and concatenate to it. `placeMarks(word, diac)` returns `null` if
the word carries any mark (the writer's marks are theirs); otherwise each
letter of the word matches the next letter of `diac` under the fold and is
followed by that letter's marks, with leading marks placed at the start.
`agreedMarks(word, diacs)` places each form and keeps, per letter, only the
mark sequence every form agrees on, returning the word unchanged when no
mark agrees (so a caller can tell "nothing agreed" from "cannot place").

### Typed features

`src/msa-features.ts` is generated by `scripts/gen-msa-features.mjs` from
the pin: the `ORDER` list as `MSA_FEATURE_NAMES` and every closed `DEFINE`
as `MSA_DEFINES`, with the types `MsaAnalysis`, `MsaPos`, `MsaValue<K>` and
the guard `isMsaValue`. It describes one database, so it is exported from
the package root rather than the engine entry, and it carries the Camel
Morph attribution in its header and a `NOTICE` row. A special-path analysis
can carry a value outside a set: `pos` `foreign` and `source` `punc` are the
two the fixtures contain.

## Parity

The engine is correct when it returns what upstream returns over the same
database. `tools/parity/` (the only Python in the repository; a pinned venv
built by `npm run parity:setup`) generates fixtures with upstream 1.6.0 over
the pin; `tests/parity/` replays them against the engine. Fixtures are
generated, never hand-edited, and never committed: `fixtures/parity/` is
git-ignored because its content is derived from the CC BY database. The
word and request lists under `fixtures/wordlists/` are committed, each with
a `NOTICE` row, and `tools/parity/scan_text.py` checks them for running
text.

**Canonical key.** Both sides serialize an analysis as JSON with keys sorted
by UTF-16 code unit, no whitespace, `ensure_ascii` off, and numbers in
JavaScript's shortest form (`-99`, not `-99.0`); analyses are sorted by that
key compared as UTF-16 code units (Python sorts by `key.encode('utf-16-be')`
because its native comparison is by code point, and the two differ once a
key holds an astral character). The committed vector
`fixtures/meta/canonical-vector.json` pins the agreement. Comparison is of
the two sorted lists, a multiset: duplicates are real upstream output.

**Fixture matrix.** `db-forms` (1,200 stem surfaces sampled from the pin,
each bare and in up to three affixed forms, plus normalization variants)
under `NONE`; `edge-cases` (invented: digits in three scripts, mixed script,
tatweel, isolated diacritics, attached punctuation, empty and whitespace
input, hamza and wasla forms, a URL-like token, `NOAN`, an emoji, an astral
character) under all five modes with `strictDigit` off and on;
`backoff-nonwords` (200 seeded strings absent from the stem table) under all
five modes; the word tokenizer over the same words; `gen-requests` (300
lemmas with up to nine requests each, clitic requests and invented edge
requests) and `reinflect-requests` (400 `db-forms` words with ten feature
bundles, the edge cases with three, and invented error bundles) over the
generator and reinflector. Each fixture header records the upstream, Python,
Unicode and emoji versions and the database identity. A word the host's
Unicode tables classify differently from Python's `unicodedata` goes into
the fixture's `knownDrift` list with both classifications and is asserted
against the host-side expectation; the pin produced none.

**Property tests** (fast-check) state the invariants the fixtures cannot:
round trips (ALMOR text, generation, the asset), determinism and cache
transparency, that lexical analyses are readings of the word, that backoff
modes nest, that a loaded asset equals the parsed model, that a changed byte
never loads, that a worker equals the in-thread analyzer, that the lexicon
equals the views, and the alignment functions' slice and mark properties.
Those that need the pin skip with a notice when `data/` lacks it. The
key-order snapshot test pins what the fixtures do not compare.

## Decisions kept for the record

Reasons behind choices a reader of the code might question.

- **No fork.** Upstream 1.6.0 unmodified loads and analyzes over the pin, so
  the port follows 1.6.0 `master` and no fork is read or cited.
- **Analyses are open records** with a data-dependent key set; the typed
  features module is a type layer over them and never reshapes them.
- **The default `cacheSize` stays 0**, upstream's default, because a cache
  aliases results and the measured gain depends on the text; the README
  recommends a size with its memory cost.
- **Results stay eager plain objects.** A lazy or proxied result would
  change the API, could not cross a worker and would make key order a
  property of the proxy.
- **The cache's victim is observable only through aliasing**, which is
  already undefined, so the O(1) tie-break differs harmlessly from
  upstream's arbitrary one.
- **The worker ships in the core package at `./worker`**, never imported by
  the core entry. A separate package would add a version-skew problem.
- **The loader is in the package root with a `node` condition**, so the
  same `import { loadDatabase } from 'shanisarf'` reads URLs in a page and
  paths in Node, and no `node:` import reaches a browser graph. The
  compiler is its own Node-only subpath because it is a build tool.
- **Two shards, not more.** The analyzer needs both parts to answer
  anything; splitting stems would only pay once stems can load partially,
  which changes output.
- **Log-probabilities are kept as published.** The scores derive from LDC
  resources upstream had access to, and upstream published the values under
  CC BY 4.0; the project relies on that statement. `stripLogprobs` is a
  compile option for a caller who prefers otherwise, and the asset's
  disclaimer says when it was used.
- **Ranking is not provided.** 78% of the pin's stems carry no score, the
  scores separate lemma and part of speech but never inflections, and a
  caller can sort by the fields in one line.
- **The lexicon holds its indexes.** Putting them on the model would grow
  every model for every caller.
- **Token spans and `analyzeText` are not provided.** An application that
  shows a document partitions its own text, whitespace included, and
  `simpleWordTokenize` drops whitespace.
- **Install by path, git URL or tarball** works without a registry:
  `prepare` builds on a git install, a path install needs a built `dist/`,
  and a tarball carries `dist/`.
