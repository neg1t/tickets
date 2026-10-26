import { writeFile } from 'node:fs/promises';
import { openApiDocument } from './dist/index.js';

await writeFile(
  new URL('./openapi.json', import.meta.url),
  `${JSON.stringify(openApiDocument, null, 2)}\n`,
  'utf8',
);
