// Marks dist/cjs as CommonJS so Node reads its .js files as CJS even though
// the root package.json declares "type": "module". Part of the dual ESM/CJS
// build.
import { mkdirSync, writeFileSync } from 'node:fs';

mkdirSync('dist/cjs', { recursive: true });
writeFileSync('dist/cjs/package.json', JSON.stringify({ type: 'commonjs' }, null, 2) + '\n');
