// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// A resolve hook that lets a plain Node child process import the engine's
// TypeScript sources: `src/` imports its siblings as `./x.js`, the compiled
// name, so a `.js` specifier from a `.ts` file that does not resolve is
// retried as `.ts`. Node strips the types itself (`process.features.typescript`).
// Used by tests that run the sources in a fresh process.
//
// Usage: node --import ./tests/support/ts-resolve-hook.mjs child.mjs

import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (specifier.endsWith('.js') && context.parentURL?.endsWith('.ts')) {
        return nextResolve(`${specifier.slice(0, -3)}.ts`, context);
      }
      throw error;
    }
  },
});
