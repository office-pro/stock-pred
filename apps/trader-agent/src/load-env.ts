import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

function loadRootEnv(): void {
  const candidates = [
    resolve(__dirname, '../../../.env'),
    resolve(__dirname, '../../.env'),
    resolve(process.cwd(), '.env'),
  ];
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const cut = line.indexOf('=');
      if (cut <= 0) continue;
      const key = line.slice(0, cut).trim();
      if (process.env[key]) continue;
      let value = line.slice(cut + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
    break;
  }
}

loadRootEnv();
