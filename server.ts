import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distServer = path.join(__dirname, 'dist', 'server.cjs');

async function main() {
  // In production or when the bundle exists, run the compiled bundle.
  // This prevents ESM/TypeScript extension resolution issues and enum runtime problems.
  if (fs.existsSync(distServer)) {
    await import(distServer);
  } else {
    // In development environments running with tsx:
    await import('./server/server');
  }
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
