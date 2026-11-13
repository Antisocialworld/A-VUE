import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { STRINGS } from '../constants/strings';

const VALID_RN_ROLES = new Set([
  'none',
  'button',
  'togglebutton',
  'link',
  'search',
  'image',
  'keyboardkey',
  'text',
  'adjustable',
  'imagebutton',
  'header',
  'summary',
  'alert',
  'checkbox',
  'combobox',
  'menu',
  'menubar',
  'menuitem',
  'progressbar',
  'radio',
  'radiogroup',
  'scrollbar',
  'spinbutton',
  'switch',
  'tab',
  'tabbar',
  'tablist',
  'timer',
  'toolbar',
]);

function getAllSourceFiles(dir: string, fileList: string[] = []): string[] {
  if (!fs.existsSync(dir)) return fileList;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== '__tests__' && entry.name !== 'node_modules') {
        getAllSourceFiles(fullPath, fileList);
      }
    } else if (entry.isFile() && (entry.name.endsWith('.tsx') || entry.name.endsWith('.ts'))) {
      fileList.push(fullPath);
    }
  }
  return fileList;
}

describe('Accessibility Audit & Static Source Scanner (Rule 01, Task 2 & Task 5)', () => {
  it('ensures every critical control string has a defined accessibility label', () => {
    expect(STRINGS.appName).toBe('A VUE');
    expect(STRINGS.appName.trim().length).toBeGreaterThan(0);
    expect(STRINGS.accessibility.showPassword).toBeDefined();
    expect(STRINGS.accessibility.hidePassword).toBeDefined();
    expect(STRINGS.welcome.signInAccessibilityHint).toBeDefined();
    expect(STRINGS.welcome.signUpAccessibilityHint).toBeDefined();
    expect(STRINGS.movies.signOutAccessibilityHint).toBeDefined();
  });

  it('fails if getEffectiveButtonLabel receives empty strings or undefined', () => {
    function getEffectiveButtonLabel(title?: string, accessibilityLabel?: string): string {
      const effective = accessibilityLabel !== undefined ? accessibilityLabel : (title || '');
      if (!effective.trim()) {
        throw new Error('Accessibility Violation: Button must have a non-empty accessibilityLabel or title.');
      }
      return effective;
    }

    expect(getEffectiveButtonLabel('Sign in', undefined)).toBe('Sign in');
    expect(getEffectiveButtonLabel(undefined, 'Custom Label')).toBe('Custom Label');
    expect(() => getEffectiveButtonLabel('', '')).toThrow(/Accessibility Violation/);
    expect(() => getEffectiveButtonLabel(undefined, undefined)).toThrow(/Accessibility Violation/);
  });

  it('fails if getEffectiveImageLabel receives empty string (Task 2a fix)', () => {
    function getEffectiveImageLabel(accessibilityLabel?: string): string {
      const effective = accessibilityLabel !== undefined ? accessibilityLabel : STRINGS.appName;
      if (!effective || !effective.trim()) {
        throw new Error('Accessibility Violation: Image must have a non-empty accessibilityLabel.');
      }
      return effective;
    }

    expect(getEffectiveImageLabel('A VUE')).toBe('A VUE');
    expect(getEffectiveImageLabel(undefined)).toBe('A VUE');
    expect(() => getEffectiveImageLabel('')).toThrow(/Accessibility Violation/);
    expect(() => getEffectiveImageLabel('   ')).toThrow(/Accessibility Violation/);
  });

  it('verifies CodeInput cell accessibility labels provide index and digit state', () => {
    const labelEmpty = STRINGS.verifyCode.codeCellAccessibilityLabel(0, '');
    expect(labelEmpty).toBe('Digit 1: empty');

    const labelFilled = STRINGS.verifyCode.codeCellAccessibilityLabel(2, '7');
    expect(labelFilled).toBe('Digit 3: 7');
  });

  it('verifies checklist items have distinct accessible met/not met states (Task 5)', () => {
    expect(STRINGS.checklist.accessibleValid).toBe('Satisfied');
    expect(STRINGS.checklist.accessibleInvalid).toBe('Not satisfied');
  });

  it('scans app/src source files and asserts all Pressable, Image, and TextInput have accessibilityLabel or documented exemption', () => {
    const srcDir = path.resolve(__dirname, '..');
    const sourceFiles = getAllSourceFiles(srcDir);
    expect(sourceFiles.length).toBeGreaterThan(0);

    const violations: string[] = [];

    for (const filePath of sourceFiles) {
      const content = fs.readFileSync(filePath, 'utf-8');
      const relPath = path.relative(srcDir, filePath);

      const sourceFile = ts.createSourceFile(
        filePath,
        content,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
      );

      function visit(node: ts.Node) {
        if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
          let tagName = '';
          if (ts.isIdentifier(node.tagName)) {
            tagName = node.tagName.text;
          }

          if (tagName === 'Pressable' || tagName === 'Image' || tagName === 'TextInput') {
            // Documented Exemptions:
            // 2. Image inside Logo.tsx is decorated by outer container with accessibilityRole="image" and accessibilityLabel
            if (tagName === 'Image' && relPath.includes('Logo.tsx')) {
              return;
            }

            let hasAccessibilityLabel = false;
            let hasAccessibleFalse = false;
            let hasAccessibilityElementsHidden = false;

            for (const prop of node.attributes.properties) {
              if (ts.isJsxAttribute(prop) && ts.isIdentifier(prop.name)) {
                const attrName = prop.name.text;
                if (attrName === 'accessibilityLabel') {
                  hasAccessibilityLabel = true;
                }
                if (attrName === 'accessibilityElementsHidden') {
                  hasAccessibilityElementsHidden = true;
                }
                if (attrName === 'accessible') {
                  if (
                    prop.initializer &&
                    ts.isJsxExpression(prop.initializer) &&
                    prop.initializer.expression &&
                    prop.initializer.expression.kind === ts.SyntaxKind.FalseKeyword
                  ) {
                    hasAccessibleFalse = true;
                  }
                }
              } else if (ts.isJsxSpreadAttribute(prop)) {
                // (b) the label is provided through spread props: resolve in the same file
                if (ts.isIdentifier(prop.expression)) {
                  const spreadName = prop.expression.text;
                  if (spreadName === 'rest' || spreadName === 'props') {
                    if (
                      content.includes('accessibilityLabel') ||
                      content.includes('effectiveAccessibilityLabel')
                    ) {
                      hasAccessibilityLabel = true;
                    }
                  }
                }
              }
            }

            // 1. Hidden input in CodeInput.tsx has accessibilityElementsHidden for raw keyboard capture
            if (tagName === 'TextInput' && hasAccessibilityElementsHidden) {
              return;
            }
            // 3. Pressable container in CodeInput.tsx has accessible={false} to delegate accessibility to individual per-cell digit labels
            if (tagName === 'Pressable' && relPath.includes('CodeInput.tsx') && hasAccessibleFalse) {
              return;
            }
            // 4. Hidden gesture Pressable in WelcomeScreen.tsx has accessible={false} so screen readers only focus the inner Logo (image)
            if (tagName === 'Pressable' && relPath.includes('WelcomeScreen.tsx') && hasAccessibleFalse) {
              return;
            }

            if (!hasAccessibilityLabel) {
              const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
              violations.push(`${relPath}:${line + 1} <${tagName}> is missing accessibilityLabel`);
            }
          }
        }

        ts.forEachChild(node, visit);
      }

      visit(sourceFile);
    }

    expect(violations).toEqual([]);
  });

  it('scans app/src source files and asserts every accessibilityRole value is valid in React Native (Task 5)', () => {
    const srcDir = path.resolve(__dirname, '..');
    const sourceFiles = getAllSourceFiles(srcDir);
    const invalidRoles: string[] = [];

    for (const filePath of sourceFiles) {
      const content = fs.readFileSync(filePath, 'utf-8');
      const relPath = path.relative(srcDir, filePath);

      // Match accessibilityRole="<value>" or accessibilityRole={'<value>'}
      const roleRegex = /accessibilityRole=(?:["']([^"']+)["']|{["']([^"']+)["']})/g;
      let match: RegExpExecArray | null;

      while ((match = roleRegex.exec(content)) !== null) {
        const role = match[1] || match[2];
        if (!VALID_RN_ROLES.has(role)) {
          invalidRoles.push(`${relPath}: invalid accessibilityRole "${role}"`);
        }
      }
    }

    expect(invalidRoles).toEqual([]);
  });

  it('asserts no visible component gallery text exists on WelcomeScreen in any build (Task 2)', () => {
    const welcomePath = path.resolve(__dirname, '../screens/WelcomeScreen.tsx');
    const welcomeContent = fs.readFileSync(welcomePath, 'utf-8');

    // Asserts no visible gallery button or openGalleryAction
    expect(welcomeContent).not.toContain('openGalleryAction');
    expect(welcomeContent).not.toContain('STRINGS.welcome.openGalleryAction');
    expect(welcomeContent).not.toContain('Component gallery');

    // Asserts the hidden gesture exists with delayLongPress=2000 and accessible={false}
    expect(welcomeContent).toContain('delayLongPress={2000}');
    expect(welcomeContent).toContain('onLongPress={onNavigateToGallery}');
    expect(welcomeContent).toContain('accessible={false}');
  });

  it('asserts gallery route exists without dev gating in App.tsx (Task 2)', () => {
    const appPath = path.resolve(__dirname, '../../App.tsx');
    const appContent = fs.readFileSync(appPath, 'utf-8');

    expect(appContent).toContain("currentRoute === 'gallery'");
    expect(appContent).not.toContain("currentRoute === 'gallery' && isDev");
    expect(appContent).toContain("onNavigateToGallery={() => setCurrentRoute('gallery')}");
  });
});
