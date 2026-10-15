# shanisarf-db-msa

The Camel Morph MSA v1.0 morphological database of Modern Standard Arabic,
compiled into shanisarf's asset format, for shanisarf's
`loadDatabase`. This package is data only: it ships no code.

> **Status: not yet published.** The package is `private` until shanisarf's
> 0.1.0 release. Its compiled `asset/` is built by
> `npm run compile:db` in the shanisarf repository and is not committed.

## Attribution

Camel Morph MSA v1.0, developed by the CAMeL Lab at New York University Abu
Dhabi (Khairallah et al., 2024), https://github.com/CAMeL-Lab/camel_morph,
licensed under CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/).
Adapted (compiled) by shanisarf.

Please cite:

> Khairallah, Christian, Salam Khalifa, Reham Marzouk, Mayar Mohamadein
> Nassar and Nizar Habash. "Camel Morph MSA: A Large-Scale Open-Source
> Morphological Analyzer for Modern Standard Arabic." LREC-COLING 2024.
> https://aclanthology.org/2024.lrec-main.240.pdf

Where you show analyses made from this database, show its attribution too.
A database loaded with shanisarf carries it as `db.provenance.credits`, with
`citation`, `license` and `disclaimer` beside it.

## License

The data is licensed under the Creative Commons Attribution 4.0
International License (CC BY 4.0): https://creativecommons.org/licenses/by/4.0/.
The license text travels as that link, here, in `NOTICE` and in the asset's
`manifest.json`. shanisarf's own MIT license applies to shanisarf's code, not
to this package.

**Disclaimer.** The database is offered under CC BY 4.0, whose Section 5
disclaims all warranties and limits liability
(https://creativecommons.org/licenses/by/4.0/legalcode#s5). This package is
shanisarf's adaptation of the database. Nothing here implies that CAMeL Lab
endorses shanisarf or this package.

## Using it

shanisarf's `loadDatabase` opens the asset: it reads `manifest.json` and the
two shards it names, checks every shard's SHA-256 and every table's
structure, and builds the database. It requests nothing else.

In a page, from a CDN or your own server, pass the asset digest (below) so
the loader refuses any other asset:

```js
import { loadDatabase, Analyzer } from 'shanisarf';

const db = await loadDatabase('https://cdn.example/shanisarf-db-msa@1.0.0/asset/', {
  manifestSha256: '<the asset digest of this release>',
});
const analyzer = new Analyzer(db);
```

In Node, from this package:

```js
import { loadDatabase } from 'shanisarf';

const db = await loadDatabase(import.meta.resolve('shanisarf-db-msa/asset/manifest.json'));
```

In a worker, so the page stays responsive while the database opens (the
page's thread reads the asset; the worker opens it and makes no request):

```js
import { createWorkerAnalyzer } from 'shanisarf/worker';

const analyzer = await createWorkerAnalyzer({
  source: { asset: '/shanisarf-db-msa/asset/', manifestSha256: '<the asset digest>' },
});
```

Show the attribution wherever you show results: `db.provenance.credits` (or
`analyzer.provenance.credits` in a worker) is the text above, with
`license`, `disclaimer` and `citation` beside it.

## What is in it

| File | What it is |
|---|---|
| `asset/manifest.json` | The asset's manifest: the database's name, version, license, credits, disclaimer, citation and source, and each shard's size and SHA-256 |
| `asset/header.bin`, `asset/stems.bin` | The two shards: the database's tables as typed arrays, filtered and deflated, the stems' `lex_logprob` and `pos_lex_logprob` as published (see `NOTICE`) |
| `NOTICE` | The attribution, citation, source and disclaimer |

The raw database file is not included. The asset is compiled from the file
at commit `15f5aede4b609db54abd6f87aded1f5ec5d930af` of
https://github.com/CAMeL-Lab/camel_morph, SHA-256
`110e03baa282874062d076e23d9671e985b6f76520b891d58cba4e55de0b8f60`, which
the manifest records as `source` and `sourceSha256`.

## Versions

The package's major and minor version are the database's: Camel Morph MSA
1.0 gives `1.0`. The patch counts releases of this database's asset, from 0.
A new asset Format_Version is a new patch release.

| Format_Version | Package versions | shanisarf versions that read it |
|---|---|---|
| 1 | 1.0.0 | 0.1.0 and later (unreleased) |

Each release's asset digest, the SHA-256 of its `manifest.json`, is in the
shanisarf repository's `packages/shanisarf-db-msa/asset-digest.json`. Pass
it as `manifestSha256` when you load the asset from a server you do not
control, and the loader refuses any other asset.
