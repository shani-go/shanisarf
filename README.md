# shanisarf

An Arabic morphological analyzer for JavaScript: every analysis a word admits
(clitics, stem, lemma, root, pattern, POS and features, diacritized form,
transliterations), offline, in any JS runtime, under permissive terms. A
TypeScript port of the analysis core of [CAMeL Tools](https://github.com/CAMeL-Lab/camel_tools)
(MIT) over the [Camel Morph MSA](https://github.com/CAMeL-Lab/camel_morph)
database (CC BY 4.0).

The analysis core, the generator and the reinflector are at parity with
CAMeL Tools 1.6.0 over the Camel Morph MSA v1.0 database (commit
`15f5aede`, SHA-256 `110e03ba…0b8f60`), proven by fixtures generated from
the Python implementation and replayed against the port. The database
compiles into a 6.1 MB asset that loads, verified, in about 0.2 s, and the
analyzer runs in a page, in Node, or in a worker. Not included, by design: a
CLI, out-of-context ranking, the morphological tokenizer, in-context
disambiguation and the Camel Morph EGY database.

- [`VISION.md`](VISION.md): why, and the principles.
- [`docs/design.md`](docs/design.md): how it is built and why.
- [`NOTICE`](NOTICE): every upstream input and what shanisarf owes it.
- [`CONTRIBUTING.md`](CONTRIBUTING.md): the rules a change must keep.

## Loading the database

The database ships compiled: a `manifest.json` and two shards, 6.1 MB in
all, which `loadDatabase` reads, checks (every shard's SHA-256 and every
table's structure) and opens into the model. It requests the manifest and
the shards it names, and nothing else. The data package
`shanisarf-db-msa` holds the Camel Morph MSA asset (in this repository,
`npm run compile:db` builds it into `packages/shanisarf-db-msa/asset/`).

In a page, pass the asset's directory URL and its digest, the SHA-256 of
its `manifest.json`, which the data package publishes. jsDelivr mirrors the
npm package, so a page can load the asset from there without a server of
its own. The loader refuses any other asset, whoever serves it:

```js
import { loadDatabase, Analyzer } from 'shanisarf';

const db = await loadDatabase('https://cdn.jsdelivr.net/npm/shanisarf-db-msa@1.0.0/asset/', {
  manifestSha256: '7523fca351c45ac82d6a002c4013f393cf0a758b4c08cde8b8f27c2fb54c782e',
});
const analyzer = new Analyzer(db);
```

In Node, a path or a `file:` URL works too, and the shards inflate with
`node:zlib`:

```js
import { loadDatabase } from 'shanisarf';

const db = await loadDatabase('node_modules/shanisarf-db-msa/asset');
// or: await loadDatabase(import.meta.resolve('shanisarf-db-msa/asset/manifest.json'));
```

The flags are the parser's: `loadDatabase(source, { flags: 'r' })` keeps the
generation tables too, for the `Generator` and `Reinflector`. A failure is
typed: `AssetReadError` (a request or a file failed), `AssetIntegrityError`
(a digest or a size differs), `AssetFormatError` (the files are not the
format), each naming the file, all of them `DatabaseError`s.

**Show the attribution with the results.** The database is CC BY 4.0, and a
loaded database carries its credits:

```js
db.provenance.credits;    // "Camel Morph MSA v1.0, developed by the CAMeL Lab at … Adapted (compiled) by shanisarf."
db.provenance.license;    // { id: 'CC-BY-4.0', url: 'https://creativecommons.org/licenses/by/4.0/' }
db.provenance.citation;   // the paper to cite
```

**To cache the asset yourself** (in IndexedDB, say), read it once and open
the bytes later; they are checked again on every open:

```js
import { readAsset, openAsset } from 'shanisarf';

const bytes = await readAsset(url, { manifestSha256 });   // { manifest, shards }
// … store bytes, and later:
const db = await openAsset(bytes, { manifestSha256 });
```

A function works as a source too: `loadDatabase((path) => cache.get(path))`
is called with `manifest.json` and then each shard's file name.

**To compile your own ALMOR database**, describe it in a Source_Record (its
URL, SHA-256, size, license, credits, disclaimer and citation; see
`packages/shanisarf-db-msa/source.json`) and use the Node-only compiler:

```js
import { compileDatabaseFile } from 'shanisarf/compile';

const { assetDigest } = await compileDatabaseFile('my.db', 'source.json', 'out/asset');
```

`parseAlmor(text)` still reads ALMOR text directly.

## Caching analyses

`new Analyzer(db, options)` caches nothing by default, as CAMeL Tools does.
For running text, where words repeat, pass `cacheSize`: on a Zipf-distributed
stream, `cacheSize: 1000` hits about 62% of the time and analyzes about 2.7×
faster. A cached word holds about 40 KB of analyses, so a full cache of N
words costs about N × 40 KB (about 39 MiB at 1,000; about 385 MiB at
10,000), on top of the database model's 98 MiB. With a cache, a repeated
word returns the same result array, so copy a result before sorting,
annotating or otherwise changing it.

## Running in a worker

`shanisarf/worker` runs the analyzer in a Web Worker in browsers and under
`worker_threads` in Node, behind one promise API. The database is opened
inside the worker, so the page stays responsive while it loads:

```js
import { createWorkerAnalyzer } from 'shanisarf/worker';

const analyzer = await createWorkerAnalyzer({
  source: { asset: '/asset/', manifestSha256 },   // read here, opened in the worker
  analyzer: { backoff: 'NOAN_PROP' },
});
analyzer.provenance.credits;   // the attribution, as on a loaded database
const analyses = await analyzer.analyze('كتاب');
const results = await analyzer.analyzeWords(['كتاب', 'قلم']); // one message for the list
await analyzer.terminate();
```

The page's thread reads the asset (the manifest and its shards, nothing
else) and transfers the bytes; the worker verifies and opens them. The
source can also be ALMOR text or its UTF-8 bytes (`source: bytes, transfer:
true`), which the worker parses.

Results are copies, so they can be changed freely, and errors arrive as the
engine's own classes. Each call is one message each way; batching with
`analyzeWords` keeps the cost near 1.6× the in-thread time per word. A runtime without
`Worker` (some edge functions) should use the in-thread `Analyzer`. The
worker makes no network request: the database reaches it in the message.

`npm run demo` serves a demo page that does all of this from one origin,
under a Content-Security-Policy that lets the page reach nothing else
(`npm run build` and `npm run compile:db` first).

## Looking up the lexicon

`Lexicon` reads the database's stem entries by lemma, stem or root, without
analyzing a word. Each result is a fresh frozen record: the stem's
`surface`, its `category`, and its `features` in the database's order.

```js
import { loadDatabase, Lexicon } from 'shanisarf';

const db = await loadDatabase('node_modules/shanisarf-db-msa/asset');
const lex = new Lexicon(db);

lex.byLemma('كِتَاب', { features: ['gloss', 'pos'] });
// [{ surface: 'كتاب', category: 'X00324', features: { gloss: 'book', pos: 'noun' } }, …]
lex.byStem('كتاب');
lex.byRoot('ك.ت.ب');                  // 69 entries
lex.byLemma('كتاب', { fold: true });  // a bare spelling finds the marked lemma
lex.lookup('root', 'ك.ت.ب');          // the same as byRoot
for (const entry of lex.entries({ features: ['lex', 'gloss'] })) { /* every entry, in line order */ }
```

- **`fold: true`** matches after `foldArabicKey` on both sides: the
  diacritics and the tatweel removed, the alef variants written bare, alef
  maksura as yaa and teh marbuta as haa. That is what the default Analyzer
  does to a word before its lookup. An exact lookup's results are always
  among the folded lookup's. `foldArabicKey` is exported too.
- **`features`** keeps only the named features, in the database's order.
  Use it for glosses: `{ features: ['gloss', 'pos'] }` builds two strings
  per entry instead of every feature.
- An unknown key gives `[]`, and a non-string key or an unknown `by`
  throws `TypeError`. The database must be loaded with flags `a` (the
  default) or `r`. A generation-only database (`g`) has no stem surfaces,
  so the constructor throws `DatabaseError`.
- The lemma, root and folded indexes are built on first use and kept on the
  `Lexicon`. Dropping it frees them, and the database is unchanged. Building
  every index takes about 70 ms (0.07× the parse) and holds about 26 MiB.
  A lookup costs about 1.3–1.6 µs per record it returns: about 4.5 µs
  for an exact lemma or a stem, 7.7 µs for a folded lemma, and about
  0.27 ms for a root, which returns about 178 entries on average.

In a worker, the analyzer has the same lookup:
`await analyzer.lookup('lemma', 'كِتَاب', { fold: true, features: ['gloss'] })`.
The worker builds one `Lexicon` on the first lookup and keeps it, beside
its model. Results are copies. `features` also keeps the copy small. The
worker must be created with flags `a` (the default) or `r`; a `g` worker is
refused when it is created. `entries()` does not cross
the worker boundary.

## Aligning with the written word

An analysis describes the word as the database writes it. Three pure
functions carry it back to the word as the person wrote it, for display.
They read no database.

```js
import { cliticSegments, placeMarks, agreedMarks } from 'shanisarf';

const word = 'وبالكتاب';
const analyses = analyzer.analyze(word);
const chosen = analyses[0];                     // the application's choice

cliticSegments(word, chosen);
// [{ role: 'proclitic', text: 'و' }, { role: 'proclitic', text: 'ب' },
//  { role: 'proclitic', text: 'ال' }, { role: 'stem', text: 'كتاب' }]
placeMarks(word, String(chosen.diac));          // 'وَبِالكِتَابِ'
agreedMarks(word, analyses.map((a) => String(a.diac)));   // 'وَبِالكتاب': only the marks every form agrees on
```

- **`cliticSegments(word, analysis, { scheme })`** cuts the word where the
  analysis's segmentation (`d3seg` by default) cuts it. Each segment is a
  slice of the word as written, with its marks and tatweel kept with the
  letter before them, and the slices join back to the word. It returns
  `null` when the scheme is missing or malformed (a piece with no letter,
  or other than one stem), or when its letters do not match the word's.
- **`placeMarks(word, diac)`** puts the marks of one diacritized form on
  the word's own letters, keeping its spelling (a bare alef stays bare). It
  returns `null` when the word already carries a mark (the writer's marks
  are not overwritten), or when the letters do not match.
- **`agreedMarks(word, diacs)`** keeps, at each letter, only the mark
  sequence every form puts there. It returns `null` if the list is empty or
  any form cannot be placed. It returns the word unchanged when no mark
  agreed. The application chooses which forms to pass.

Letters are compared after `foldArabicKey`, the default Analyzer's own
normalization. An Analyzer built with a custom `normMap` can match letters
that the fold does not, so these functions return `null` more often for its
analyses. `null` means "cannot align" and is never a wrong alignment. Over
the database's own word list, `placeMarks` places every lexical analysis
whose `diac` has no underscore (55,729 of 55,729), and `cliticSegments`
segments 95.3% of those whose scheme marks a clitic.

## Typed features

The package root exports the Camel Morph MSA database's feature names and
closed value sets as constants and types: `MSA_FEATURE_NAMES` (53),
`MSA_DEFINES` (23 sets, such as `pos`, `gen` and `num`), `MsaAnalysis`,
`MsaPos`, `MsaValue<'gen'>` and the guard `isMsaValue('pos', value)`. The
module is generated from the database (`npm run gen:features`) and carries
its attribution. An analysis from a special path can carry a value outside
a set: `pos` `foreign` and `source` `punc`.

## Installing

```sh
npm install shanisarf shanisarf-db-msa
```

`shanisarf-db-msa` is the database; skip it if you serve the asset from
elsewhere or compile your own. To install an unreleased state, use a clone, a git URL or a tarball:

```sh
# a path: a linked directory runs no install script, so dist/ must be built in the clone
(cd ../shanisarf && npm install)   # `prepare` builds; after a change, `npm run build`
npm install ../shanisarf

# a git URL: npm clones it, installs its devDependencies and runs `prepare`, which builds
npm install github:shani-go/shanisarf

# a tarball
(cd ../shanisarf && npm pack)
npm install ../shanisarf/shanisarf-<version>.tgz
```

`prepare` runs `npm run build`, so in this repository every bare
`npm install` or `npm ci` builds, and so does `npm pack`. The package has
no runtime dependencies. In a clone, the database package is
`packages/shanisarf-db-msa`, built by `npm run compile:db`. Copy its
`asset/` directory where the page can fetch it, or load it by path in Node.

`npm run check:consumer` proves the three installs. It packs the package,
installs it offline into scratch consumers by tarball, by `git+file://` at
`HEAD` (the committed tree; it says when the working tree is dirty) and by
path, and runs an ESM and a CommonJS script in each: imports, analysis, a
lexicon lookup, the alignment functions, a worker, and the data package's
asset. `node scripts/check-consumer.mjs --vite` also builds a page with Vite
from the registry, into the scratch consumer only. Vite needs no
configuration: the worker becomes its own chunk, and no `node:` module
reaches the page.

## Performance

Measured in October 2026 on an Apple M2 Max with Node 26, Python 3.14 and
Chromium 152, over the committed word lists (5,028 words), cache off, best
of three runs. `npm run bench` and `npm run measure:db` reproduce them.

| Measure | Value |
|---|---|
| Parse of the 85 MB text, Node | about 1.0 s |
| Load of the 6.1 MB asset, Node | about 0.2 s |
| Memory after a load, Node | about 100 MiB retained |
| Analysis, Node | about 90 µs per word |
| Analysis, Chromium | about 70 µs per word |
| CAMeL Tools 1.6.0 in process, same words | about 390 µs per word |
| Worker, 100 words per request | about 1.6× the in-thread time per word |
| Every lexicon index built | about 70 ms, about 26 MiB |

## License

shanisarf's own code is MIT ([`LICENSE`](LICENSE)). It is a transformation of
CAMeL Tools, © 2018–2026 New York University Abu Dhabi, MIT License; the
upstream license is reproduced verbatim at
[`licenses/CAMEL_TOOLS_LICENSE`](licenses/CAMEL_TOOLS_LICENSE) and applies to
the ported portions. The Camel Morph repository's own license is at
[`licenses/CAMEL_MORPH_LICENSE`](licenses/CAMEL_MORPH_LICENSE); its **data**
(the database shanisarf compiles) is CC BY 4.0, with attribution to CAMeL Lab,
New York University Abu Dhabi, carried in [`NOTICE`](NOTICE) and inside every
compiled asset. Personal, educational, research and commercial use are all
welcome.

## A request about training

This is a request, not a license term, and it does not narrow the MIT
license above: the developer asks that this repository not be used to train
or improve machine-learning models. It is also stated in
[`VISION.md`](VISION.md).

## Citation

If you use shanisarf in research, please cite CAMeL Tools, as its authors ask:

```bibtex
@inproceedings{obeid-etal-2020-camel,
   title = "{CAM}e{L} Tools: An Open Source Python Toolkit for {A}rabic Natural Language Processing",
   author = "Obeid, Ossama  and
      Zalmout, Nasser  and
      Khalifa, Salam  and
      Taji, Dima  and
      Oudah, Mai  and
      Alhafni, Bashar  and
      Inoue, Go  and
      Eryani, Fadhl  and
      Erdmann, Alexander  and
      Habash, Nizar",
   booktitle = "Proceedings of the 12th Language Resources and Evaluation Conference",
   month = may,
   year = "2020",
   address = "Marseille, France",
   publisher = "European Language Resources Association",
   url = "https://www.aclweb.org/anthology/2020.lrec-1.868",
   pages = "7022--7032",
   language = "English",
   ISBN = "979-10-95546-34-4",
}
```

and Camel Morph MSA for the database (Khairallah, Khalifa, Marzouk, Nassar and
Habash, LREC-COLING 2024; see [`NOTICE`](NOTICE)).

## The name

Shani is the developer's dog, a brindle Jindo. *ṣarf* (صَرْف) is Arabic for
morphology, the science of how words are built from roots. (In Arabic
script, the name is spelled شاني صرف.) See [`VISION.md`](VISION.md).
