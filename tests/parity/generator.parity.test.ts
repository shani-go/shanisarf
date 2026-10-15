// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// The generator parity replay: `Generator.generate` over the Database_Pin
// parsed with `r`, against
// `fixtures/parity/generation/generator.gen-requests.json.gz`. The comparison
// rules are in `generation-replay.ts`; skips when `data/` lacks the pin.

import { Generator } from '../../src/engine/index.js';

import { replayGeneration } from './generation-replay';

await replayGeneration('generator parity', 'generator.gen-requests.json.gz', (db) => {
  const generator = new Generator(db);
  return (lemma, feats) => generator.generate(lemma, feats);
});
