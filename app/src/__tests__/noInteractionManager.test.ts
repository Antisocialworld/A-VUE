import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

function getAllSourceFiles(dir: string, fileList: string[] = []): string[] {
  if (!fs.existsSync(dir)) return fileList;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') {
        getAllSourceFiles(fullPath, fileList);
      }
    } else if (entry.isFile() && (entry.name.endsWith('.tsx') || entry.name.endsWith('.ts'))) {
      fileList.push(fullPath);
    }
  }
  return fileList;
}

function hasInteractionManagerUsage(content: string, filePath: string): boolean {
  const sourceFile = ts.createSourceFile(
    filePath,
    content,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  let found = false;

  function visit(node: ts.Node) {
    if (found) return;

    // 1. Import specifiers or default imports (e.g. import { InteractionManager } from 'react-native')
    if (ts.isImportSpecifier(node)) {
      if (node.name.text === 'InteractionManager' || node.propertyName?.text === 'InteractionManager') {
        found = true;
        return;
      }
    }
    if (ts.isImportClause(node) && node.name?.text === 'InteractionManager') {
      found = true;
      return;
    }

    // 2. require('InteractionManager')
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'require' &&
      node.arguments.length > 0 &&
      ts.isStringLiteral(node.arguments[0]) &&
      node.arguments[0].text === 'InteractionManager'
    ) {
      found = true;
      return;
    }

    // 3. Identifier use (e.g. InteractionManager.runAfterInteractions, const im = InteractionManager)
    if (ts.isIdentifier(node) && node.text === 'InteractionManager') {
      found = true;
      return;
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return found;
}

describe('InteractionManager Removal Audit (React Native 0.88 / Expo SDK 58)', () => {
  it('asserts no file in app/src imports or uses InteractionManager (ignoring comments and string literals)', () => {
    const srcDir = path.resolve(__dirname, '..');
    const sourceFiles = getAllSourceFiles(srcDir);
    expect(sourceFiles.length).toBeGreaterThan(0);

    const violations: string[] = [];

    for (const filePath of sourceFiles) {
      // Exclude test files
      if (filePath.includes('__tests__')) {
        continue;
      }

      const content = fs.readFileSync(filePath, 'utf-8');
      if (hasInteractionManagerUsage(content, filePath)) {
        const relPath = path.relative(srcDir, filePath);
        violations.push(
          `${relPath}: imports or references InteractionManager (removed from React Native core)`,
        );
      }
    }

    expect(violations).toEqual([]);
  });

  it('demonstrates that comments mentioning InteractionManager are ignored, but imports and calls are caught', () => {
    const commentOnlyCode = `
      /**
       * Modern React Native 0.88+: InteractionManager removed from core.
       * Uses requestIdleCallback instead.
       */
      export function testHook() {
        return 42;
      }
    `;
    expect(hasInteractionManagerUsage(commentOnlyCode, 'testHook.ts')).toBe(false);

    const importCode = `
      import { InteractionManager } from 'react-native';
      InteractionManager.runAfterInteractions(() => {});
    `;
    expect(hasInteractionManagerUsage(importCode, 'badHook.ts')).toBe(true);
  });
});


