import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const srcRoot = path.resolve(__dirname, '..');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (/\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

describe('web startup safety', () => {
  it('keeps the TMDB asset lookup optional at module scope with the 851x199 fallback', () => {
    const src = fs.readFileSync(path.join(srcRoot, 'components/TmdbAttribution.tsx'), 'utf-8');
    expect(src).toContain('Image.resolveAssetSource?.(tmdbLogoSource)');
    expect(src).not.toContain('const resolvedAsset = Image.resolveAssetSource(');
    expect(src).toContain('resolvedAsset.width : 851');
    expect(src).toContain('resolvedAsset.height : 199');
    expect(fs.readFileSync(path.join(srcRoot, 'constants/strings.ts'), 'utf-8')).toContain(
      "tmdbAttribution:",
    );
  });

  it('has no other module-level native-only API calls in app/src', () => {
    const forbidden = [
      'Image.resolveAssetSource(',
      'NativeModules.',
      'requireNativeComponent(',
      'TurboModuleRegistry.get(',
      'AsyncStorage.',
      'SQLite.',
    ];
    for (const file of sourceFiles(srcRoot)) {
      for (const line of fs.readFileSync(file, 'utf-8').split(/\r?\n/)) {
        if (!/^(?:export\s+)?const\s/.test(line)) continue;
        for (const token of forbidden) {
          expect(line).not.toContain(token);
        }
      }
    }
  });
});
