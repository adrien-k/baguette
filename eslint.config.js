import js from '@eslint/js';
import globals from 'globals';
import reactPlugin from 'eslint-plugin-react';
import reactHooksPlugin from 'eslint-plugin-react-hooks';
import prettierConfig from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

export default [
  {
    ignores: [
      'node_modules/**',
      'client/node_modules/**',
      'dist/**',
      'client/dist/**',
      'client/scripts/**',
      '.data/**',
    ],
  },

  {
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': 'error',
    },
  },

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
