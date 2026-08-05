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
