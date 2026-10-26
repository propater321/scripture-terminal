import { existsSync } from 'node:fs';
import { join } from 'node:path';
export function missingData(files: string[]) {
  const missing = files.filter(file => !existsSync(join(import.meta.dir, '../../data', file + '.sqlite')));
  if (missing.length) console.warn(`Skipping corpus integration tests: missing ${missing.join(', ')}. See bun run test:integration.`);
  return missing.length > 0;
}
