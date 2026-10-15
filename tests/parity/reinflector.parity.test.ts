// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// The reinflector parity replay: `Reinflector.reinflect` over the Database_Pin
// parsed with `r`, against
// `fixtures/parity/generation/reinflector.reinflect-requests.json.gz`. The
// comparison rules are in `generation-replay.ts`; skips when `data/` lacks the
// pin.

import { Reinflector } from '../../src/engine/index.js';

import { replayGeneration } from './generation-replay';

await replayGeneration('reinflector parity', 'reinflector.reinflect-requests.json.gz', (db) => {
  const reinflector = new Reinflector(db);
  return (word, feats) => reinflector.reinflect(word, feats);
});
