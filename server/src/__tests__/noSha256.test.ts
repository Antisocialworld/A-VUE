import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const serverRoot = path.resolve(__dirname, '../..');
const scanRoots = [path.join(serverRoot, 'src/lib'), path.join(serverRoot, 'src/routes')];
const SHA256_RE = /sha-?256/i;

const ALLOWED_FILES = new Set([
  'server/src/routes/tickets.ts',
  'server/src/lib/jobs.ts',
]);

function relativePath(file: string): string {
  return `server/${path.relative(serverRoot, file).split(path.sep).join('/')}`;
}

function collectTsFiles(dir: string, fileList: string[] = []): string[] {
  if (!fs.existsSync(dir)) return fileList;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectTsFiles(full, fileList);
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      fileList.push(full);
    }
  }
  return fileList;
}

describe('SHA-256 guard', () => {
  it('allowlists only the tickets QR route and the jobs QR reference hash', () => {
    expect([...ALLOWED_FILES].sort()).toEqual([
      'server/src/lib/jobs.ts',
      'server/src/routes/tickets.ts',
    ]);
  });

  it('finds no SHA-256 references outside the allowlisted lib and routes files', () => {
    const files = scanRoots.flatMap((root) => collectTsFiles(root));
    expect(files.length).toBeGreaterThan(0);

    const violations: string[] = [];
    for (const file of files) {
      const rel = relativePath(file);
      if (ALLOWED_FILES.has(rel)) continue;
      const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
      lines.forEach((line, index) => {
        if (SHA256_RE.test(line)) violations.push(`${rel}:${index + 1}`);
      });
    }

    expect(violations).toEqual([]);
  });
});
