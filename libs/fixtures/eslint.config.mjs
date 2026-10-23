import baseConfig from '../../eslint.config.mjs';

export default [
  ...baseConfig,
  {
    files: ['**/fixtures.spec.ts'],
    // Fixture validation tests may import domain schemas; production fixtures stay static.
    rules: { '@nx/enforce-module-boundaries': 'off' },
  },
];
