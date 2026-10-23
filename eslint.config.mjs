import nx from '@nx/eslint-plugin';
import eslintConfigPrettier from 'eslint-config-prettier/flat';

export default [
  ...nx.configs['flat/base'],
  ...nx.configs['flat/typescript'],
  ...nx.configs['flat/javascript'],
  ...nx.configs['flat/react'],
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        {
          allow: [],
          enforceBuildableLibDependency: true,
          depConstraints: [
            {
              sourceTag: 'scope:studio',
              onlyDependOnLibsWithTags: ['scope:studio', 'scope:shared'],
            },
            {
              sourceTag: 'scope:embed',
              onlyDependOnLibsWithTags: ['scope:embed', 'scope:shared'],
            },
            {
              sourceTag: 'scope:shared',
              onlyDependOnLibsWithTags: ['scope:shared'],
            },
            {
              sourceTag: 'layer:app',
              onlyDependOnLibsWithTags: [
                'layer:pages',
                'layer:widgets',
                'layer:features',
                'layer:entities',
                'layer:shared',
              ],
            },
            {
              sourceTag: 'layer:pages',
              onlyDependOnLibsWithTags: [
                'layer:widgets',
                'layer:features',
                'layer:entities',
                'layer:shared',
              ],
            },
            {
              sourceTag: 'layer:widgets',
              onlyDependOnLibsWithTags: [
                'layer:features',
                'layer:entities',
                'layer:shared',
              ],
            },
            {
              sourceTag: 'layer:features',
              onlyDependOnLibsWithTags: ['layer:entities', 'layer:shared'],
            },
            {
              sourceTag: 'layer:entities',
              onlyDependOnLibsWithTags: ['layer:shared'],
            },
            {
              sourceTag: 'layer:shared',
              onlyDependOnLibsWithTags: ['layer:shared'],
            },
          ],
        },
      ],
    },
  },
  {
    ignores: [
      '**/coverage/**',
      '**/dist/**',
      '**/node_modules/**',
      '**/out-tsc/**',
      '**/vitest.config.*.timestamp*',
      '**/test-output',
    ],
  },
  eslintConfigPrettier,
];
