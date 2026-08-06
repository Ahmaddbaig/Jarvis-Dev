import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';
import reactHooks from 'eslint-plugin-react-hooks';
import typescriptEslint from 'typescript-eslint';

export default defineConfig([
  ...nextVitals,
  ...nextTypescript,
  {
    // These React 19 compiler diagnostics describe pre-refactor behavior. Keep
    // them visible and ratcheted by the lint budget while components migrate.
    plugins: {
      '@typescript-eslint': typescriptEslint.plugin,
      'react-hooks': reactHooks,
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
    },
  },
  {
    // Package layering. @jarvis/contracts is the only dependency-free layer,
    // and @jarvis/core's root barrel re-exports ./policy, which pulls in
    // node:crypto — importing it from renderer code would drag a Node builtin
    // into the browser bundle. Renderer code must use the subpath exports.
    files: ['frontend/**/*.{ts,tsx}', 'app/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [{
          name: '@jarvis/core',
          message: 'Import a @jarvis/core subpath (e.g. @jarvis/core/tool-catalog); the root barrel pulls node:crypto into the browser bundle.',
        }, {
          name: '@jarvis/persistence',
          message: '@jarvis/persistence is server-only (node:sqlite). Reach it through backend/persistence instead.',
        }, {
          name: '@jarvis/secrets',
          message: '@jarvis/secrets is server-only. Renderer code must go through the settings/credentials API.',
        }],
      }],
    },
  },
  {
    // Contracts is the base of the dependency graph: everything may import it,
    // it may import nothing of ours.
    files: ['packages/contracts/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['@jarvis/*', '@/*', '**/frontend/**', '**/backend/**', '**/apps/**'],
          message: '@jarvis/contracts must stay dependency-free; it is the base of the package graph.',
        }],
      }],
    },
  },
  {
    files: ['**/*.js', '**/*.cjs'],
    plugins: {
      '@typescript-eslint': typescriptEslint.plugin,
    },
    rules: {
      // The repository is not ESM (`package.json` has no `type: module`), so
      // executable Node/Electron helper scripts intentionally use CommonJS.
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  globalIgnores([
    '.build/**',
    '.next/**',
    'dist-electron/**',
    'release/**',
    'scripts/dist/**',
    'public/vad/**',
  ]),
]);
