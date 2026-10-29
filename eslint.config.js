import js from '@eslint/js';
import globals from 'globals';
import { importX } from 'eslint-plugin-import-x';
import reactPlugin from 'eslint-plugin-react';
import reactHooksPlugin from 'eslint-plugin-react-hooks';
import prettierConfig from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

/** Full-module graph scan for unused exports; enable via `pnpm run lint:exports` (CI). */
const checkUnusedExports = process.env.ESLINT_CHECK_UNUSED_EXPORTS === '1';

/** Paths whose exports are consumed outside static import analysis (app entrypoints, config). */
const unusedExportIgnorePaths = [
  'eslint.config.js',
  'knexfile.js',
  'vitest.config.js',
  'server/index.js',
  'client/postcss.config.js',
  'client/vite.config.js',
  // Knex loads migration up/down by convention, not static imports.
  'server/migrations',
  // Pi loads this extension entry via jiti at runtime.
  'server/pi/extensions/lunaroute-chat',
];

const importXUnusedExportSettings = {
  // Required for no-unused-modules to scan JSX/TS importers (default is .js only).
  'import-x/extensions': ['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx'],
  'import-x/parsers': {
    '@typescript-eslint/parser': ['.ts', '.tsx'],
  },
  'import-x/resolver': {
    typescript: {
      project: './tsconfig.json',
    },
    node: true,
  },
};

const unusedExportRuleOptions = (src, ignoreExports) => [
  'error',
  {
    unusedExports: true,
    ignoreUnusedTypeExports: true,
    src,
    ignoreExports: [...unusedExportIgnorePaths, ...ignoreExports],
  },
];

export default [
  {
    ignores: [
      'node_modules/**',
      'client/node_modules/**',
      'dist/**',
      'client/dist/**',
      'client/scripts/**',
      '.data/**',
      '.claude/**',
    ],
  },

  {
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': 'error',
    },
  },

  ...(checkUnusedExports
    ? [
        // Scoped `src` graphs — a single repo-wide scan false-positives on cross-root default exports.
        {
          files: ['server/**/*.{js,ts}', 'scripts/**/*.js', 'knexfile.js', 'vitest.config.js'],
          plugins: {
            'import-x': importX,
          },
          settings: importXUnusedExportSettings,
          rules: {
            'import-x/no-unused-modules': unusedExportRuleOptions(
              [
                './server',
                './shared',
                './scripts',
                './client/src',
                'knexfile.js',
                'vitest.config.js',
              ],
              []
            ),
          },
        },
        // Shared is consumed via `@baguette/shared/*` aliases; unused-export analysis false-positives there.
        {
          files: ['shared/**/*.{js,ts}'],
          rules: {
            'import-x/no-unused-modules': 'off',
          },
        },
        {
          files: ['client/src/**/*.{js,jsx,ts,tsx}'],
          plugins: {
            'import-x': importX,
          },
          settings: importXUnusedExportSettings,
          rules: {
            'import-x/no-unused-modules': unusedExportRuleOptions(
              ['./client/src', './shared'],
              ['client/src/main.jsx']
            ),
          },
        },
      ]
    : []),

  // Server + shared (Node.js ESM, plain JS)
  {
    files: [
      'server/**/*.js',
      'shared/**/*.js',
      'scripts/**/*.js',
      'bin/**',
      'knexfile.js',
      'vitest.config.js',
    ],
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
  },

  // Server + shared TypeScript (agent services, typed message models)
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: ['server/**/*.ts', 'shared/**/*.ts'],
    languageOptions: {
      ...(config.languageOptions ?? {}),
      globals: {
        ...globals.node,
      },
    },
    rules: {
      ...(config.rules ?? {}),
      // TS files are type-checked by tsc; keep lint focused on style/patterns.
      '@typescript-eslint/no-explicit-any': 'error',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  })),

  // Operator-facing CLI scripts print to stdout/stderr.
  {
    files: ['scripts/**/*.js'],
    rules: {
      'no-console': 'off',
    },
  },

  // Client (React + JSX)
  {
    files: ['client/src/**/*.{js,jsx}'],
    ...js.configs.recommended,
    plugins: {
      react: reactPlugin,
      'react-hooks': reactHooksPlugin,
    },
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
      },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    settings: {
      react: { version: '19' },
    },
    rules: {
      // Client block sets `rules` explicitly; merge recommended so `no-undef` etc. are not dropped.
      ...js.configs.recommended.rules,
      ...reactPlugin.configs.recommended.rules,
      ...reactHooksPlugin.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      'react-hooks/purity': 'off',
      'react-hooks/set-state-in-effect': 'off',
    },
  },

  // Client TypeScript / TSX (typed chat renderer)
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: ['client/src/**/*.ts', 'client/src/**/*.tsx'],
    plugins: {
      ...(config.plugins ?? {}),
      react: reactPlugin,
      'react-hooks': reactHooksPlugin,
    },
    languageOptions: {
      ...(config.languageOptions ?? {}),
      sourceType: 'module',
      globals: {
        ...globals.browser,
      },
      parserOptions: {
        ...(config.languageOptions?.parserOptions ?? {}),
        ecmaFeatures: { jsx: true },
      },
    },
    settings: {
      react: { version: '19' },
    },
    rules: {
      ...(config.rules ?? {}),
      ...reactPlugin.configs.recommended.rules,
      ...reactHooksPlugin.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      'react-hooks/purity': 'off',
      'react-hooks/set-state-in-effect': 'off',
      '@typescript-eslint/no-explicit-any': 'error',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  })),

  prettierConfig,
];
