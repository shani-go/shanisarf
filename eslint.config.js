// ESLint flat config. The one project-specific rule, `shanisarf/no-js-string-
// semantics`, enforces the port's Python-string-semantics invariant under
// src/engine/: no String.prototype.trim family, no \s / \d in a regular
// expression.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import noJsStringSemantics from './eslint-rules/no-js-string-semantics.js';

const shanisarf = {
  rules: {
    'no-js-string-semantics': noJsStringSemantics,
  },
};

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'coverage/**',
      'data/**',
      // Worktrees the Claude desktop app keeps inside the checkout.
      '.claude/**',
      // The git-ignored parity venv (tools/parity/.venv/) vendors Python
      // packages that ship stray browser JS; it is not project source.
      'tools/parity/.venv/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Node-run build/harness scripts, the parity harness .mjs helpers, and the
    // local ESLint rule module.
    files: [
      'scripts/**/*.mjs',
      'tools/parity/**/*.mjs',
      'tests/support/**/*.mjs',
      'eslint-rules/**/*.js',
      'eslint.config.js',
    ],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        require: 'readonly',
        module: 'writable',
        Buffer: 'readonly',
        // Exposed by `node --expose-gc`, which the memory measurements run under.
        gc: 'readonly',
      },
    },
  },
  {
    // The demo page's script runs in a browser.
    files: ['demo/**/*.js'],
    languageOptions: {
      globals: {
        document: 'readonly',
        performance: 'readonly',
        URL: 'readonly',
      },
    },
  },
  {
    // The invariant applies only to the ported engine.
    files: ['src/engine/**/*.ts'],
    plugins: { shanisarf },
    rules: {
      'shanisarf/no-js-string-semantics': 'error',
    },
  },
);
