import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'

// Deliberately minimal. TypeScript (`npm run build`) already covers types,
// undefined names, and unused code, so ESLint's only job here is the Rules of
// React — the one class of bug tsc can't see and React Compiler fails
// silently on.
export default [
  { ignores: ['dist', 'dev-dist'] },

  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      // Parser only, not typescript-eslint's rule sets — tsc does that job.
      parser: tseslint.parser,
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
  },

  // Rules of React / React Compiler correctness.
  reactHooks.configs.flat['recommended-latest'],
]
