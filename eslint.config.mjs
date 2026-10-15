import eslint from '@electron-toolkit/eslint-config'
import eslintConfigPrettier from '@electron-toolkit/eslint-config-prettier'
import eslintPluginReact from 'eslint-plugin-react'
import eslintPluginReactHooks from 'eslint-plugin-react-hooks'
import eslintPluginReactRefresh from 'eslint-plugin-react-refresh'

export default [
  { ignores: ['**/node_modules', '**/dist', '**/out', 'scratch/**', 'fix_tofixed*.js'] },
  eslint,
  eslintPluginReact.configs.flat.recommended,
  eslintPluginReact.configs.flat['jsx-runtime'],
  {
    settings: {
      react: {
        version: 'detect'
      }
    }
  },
  {
    files: ['**/*.{js,jsx}'],
    plugins: {
      'react-hooks': eslintPluginReactHooks,
      'react-refresh': eslintPluginReactRefresh
    },
    rules: {
      ...eslintPluginReactHooks.configs.recommended.rules,
      ...eslintPluginReactRefresh.configs.vite.rules,
      // React 19 no longer evaluates propTypes at runtime; the rule only produced noise.
      'react/prop-types': 'off',
      // Conventional relaxations: unused caught errors and empty catch blocks are intentional
      // best-effort paths (e.g. idempotent migrations); a leading underscore marks unused args.
      'no-unused-vars': [
        'error',
        { args: 'after-used', argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none', ignoreRestSiblings: true }
      ],
      'no-empty': ['error', { allowEmptyCatch: true }],
      // Advisory React Compiler rule; the flagged effects are legacy data-loading/reset patterns
      // whose refactor carries behaviour risk. Tracked in .docs/TESTING_AND_KNOWN_ISSUES.md.
      'react-hooks/set-state-in-effect': 'warn'
    }
  },
  eslintConfigPrettier
]
