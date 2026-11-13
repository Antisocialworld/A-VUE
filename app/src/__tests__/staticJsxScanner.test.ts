import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

function getTsxFiles(dir: string, fileList: string[] = []): string[] {
  if (!fs.existsSync(dir)) return fileList;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== '__tests__' && entry.name !== 'node_modules') {
        getTsxFiles(fullPath, fileList);
      }
    } else if (entry.isFile() && entry.name.endsWith('.tsx')) {
      fileList.push(fullPath);
    }
  }
  return fileList;
}

describe('Static JSX Identifier & Component Scanner (Task 1 & Task 2)', () => {
  it('scans every .tsx file in app/src and app/App.tsx and fails if any PascalCase JSX tag is not imported or declared', () => {
    const appDir = path.resolve(__dirname, '../..');
    const srcDir = path.resolve(__dirname, '..');
    const tsxFiles = getTsxFiles(srcDir);
    const appTsx = path.join(appDir, 'App.tsx');
    if (fs.existsSync(appTsx)) {
      tsxFiles.push(appTsx);
    }

    expect(tsxFiles.length).toBeGreaterThan(0);

    const violations: string[] = [];

    for (const filePath of tsxFiles) {
      const relPath = path.relative(appDir, filePath);
      const content = fs.readFileSync(filePath, 'utf-8');

      const sourceFile = ts.createSourceFile(
        filePath,
        content,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
      );

      const importedIdentifiers = new Set<string>();
      const declaredIdentifiers = new Set<string>();
      const jsxTagsUsed: { name: string; line: number }[] = [];

      function collectBindingIdentifiers(nameNode: ts.BindingName) {
        if (ts.isIdentifier(nameNode)) {
          declaredIdentifiers.add(nameNode.text);
        } else if (ts.isObjectBindingPattern(nameNode) || ts.isArrayBindingPattern(nameNode)) {
          for (const element of nameNode.elements) {
            if (ts.isBindingElement(element)) {
              collectBindingIdentifiers(element.name);
            }
          }
        }
      }

      function visit(node: ts.Node) {
        // 1. Imports
        if (ts.isImportDeclaration(node)) {
          if (node.importClause?.name) {
            importedIdentifiers.add(node.importClause.name.text);
          }
          if (node.importClause?.namedBindings) {
            if (ts.isNamedImports(node.importClause.namedBindings)) {
              for (const elem of node.importClause.namedBindings.elements) {
                importedIdentifiers.add(elem.name.text);
              }
            } else if (ts.isNamespaceImport(node.importClause.namedBindings)) {
              importedIdentifiers.add(node.importClause.namedBindings.name.text);
            }
          }
        }

        // 2. Declarations
        if (ts.isVariableDeclaration(node)) {
          collectBindingIdentifiers(node.name);
        }
        if (ts.isFunctionDeclaration(node) && node.name) {
          declaredIdentifiers.add(node.name.text);
        }
        if (ts.isClassDeclaration(node) && node.name) {
          declaredIdentifiers.add(node.name.text);
        }
        if (ts.isTypeAliasDeclaration(node)) {
          declaredIdentifiers.add(node.name.text);
        }
        if (ts.isInterfaceDeclaration(node)) {
          declaredIdentifiers.add(node.name.text);
        }
        if (ts.isEnumDeclaration(node)) {
          declaredIdentifiers.add(node.name.text);
        }
        if (ts.isParameter(node)) {
          collectBindingIdentifiers(node.name);
        }

        // 3. JSX Tags
        if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
          let rootTagName: string | null = null;
          let expr: ts.JsxTagNameExpression = node.tagName;

          while (ts.isPropertyAccessExpression(expr)) {
            expr = expr.expression as ts.JsxTagNameExpression;
          }

          if (ts.isIdentifier(expr)) {
            rootTagName = expr.text;
          }

          if (rootTagName && /^[A-Z]/.test(rootTagName)) {
            const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
            jsxTagsUsed.push({ name: rootTagName, line: line + 1 });
          }
        }

        ts.forEachChild(node, visit);
      }

      visit(sourceFile);

      for (const { name: tag, line } of jsxTagsUsed) {
        const isImported = importedIdentifiers.has(tag);
        const isDeclared = declaredIdentifiers.has(tag);

        if (!isImported && !isDeclared) {
          violations.push(
            `${relPath}:${line} uses PascalCase JSX tag <${tag}> which is neither imported nor declared in this file`,
          );
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it('proves the scanner catches unimported JSX tags when simulating missing EmptyState', () => {
    const brokenSnippet = `
      import React from 'react';
      import { View } from 'react-native';
      export const TestScreen = () => <View><EmptyState title="Hi" /></View>;
    `;

    const sourceFile = ts.createSourceFile(
      'mock.tsx',
      brokenSnippet,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );

    const imported = new Set<string>();
    const declared = new Set<string>();
    const tags: string[] = [];

    function visit(node: ts.Node) {
      if (ts.isImportDeclaration(node)) {
        if (node.importClause?.name) imported.add(node.importClause.name.text);
        if (node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings)) {
          for (const el of node.importClause.namedBindings.elements) imported.add(el.name.text);
        }
      }
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
        declared.add(node.name.text);
      }
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        if (ts.isIdentifier(node.tagName) && /^[A-Z]/.test(node.tagName.text)) {
          tags.push(node.tagName.text);
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(sourceFile);

    const missingTags = tags.filter((t) => !imported.has(t) && !declared.has(t));
    expect(missingTags).toContain('EmptyState');
  });
});

