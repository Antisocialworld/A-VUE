import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('App Account Menu & Deletion Client Flow (Task 4)', () => {
  const accountMenuPath = path.resolve(__dirname, '../components/AccountMenu.tsx');
  const authClientPath = path.resolve(__dirname, '../api/authClient.ts');
  const appPath = path.resolve(__dirname, '../../App.tsx');
  const moviesHomePath = path.resolve(__dirname, '../screens/MoviesHomeScreen.tsx');
  const signInPath = path.resolve(__dirname, '../screens/SignInScreen.tsx');
  const stringsPath = path.resolve(__dirname, '../constants/strings.ts');

  const accountMenuSrc = fs.readFileSync(accountMenuPath, 'utf-8');
  const authClientSrc = fs.readFileSync(authClientPath, 'utf-8');
  const appSrc = fs.readFileSync(appPath, 'utf-8');
  const moviesHomeSrc = fs.readFileSync(moviesHomePath, 'utf-8');
  const signInSrc = fs.readFileSync(signInPath, 'utf-8');
  const stringsSrc = fs.readFileSync(stringsPath, 'utf-8');

  it('strings.ts defines complete STRINGS.account section with menu, grace notice, and errors', () => {
    expect(stringsSrc).toContain('account: {');
    expect(stringsSrc).toContain('menuAccessibilityLabel');
    expect(stringsSrc).toContain('deleteConfirmTitle');
    expect(stringsSrc).toContain('deleteStep1Prompt');
    expect(stringsSrc).toContain('deleteStep2Prompt');
    expect(stringsSrc).toContain('deleteGracePeriodNotice');
    expect(stringsSrc).toContain('hasUpcomingTicketsError');
    expect(stringsSrc).toContain('restorePromptTitle');
    expect(stringsSrc).toContain('restoreAction');
  });

  it('strings.ts defines single ACCOUNT_DELETION_GRACE_DAYS constant as 30 and tap restore notice', () => {
    expect(stringsSrc).toContain('export const ACCOUNT_DELETION_GRACE_DAYS = 30;');
    expect(stringsSrc).toContain('ACCOUNT_DELETION_GRACE_DAYS}-day grace period');
    expect(stringsSrc).toContain('Until then, sign in and tap Restore to keep it.');
  });

  it('AccountMenu renders 36pt button with 44pt effective tap target (hitSlop)', () => {
    expect(accountMenuSrc).toContain('width: 36');
    expect(accountMenuSrc).toContain('height: 36');
    expect(accountMenuSrc).toContain('borderRadius: 18');
    expect(accountMenuSrc).toContain('hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}');
  });

  it('AccountMenu uses vector Svg and accessibility roles and labels', () => {
    expect(accountMenuSrc).toContain('<Svg');
    expect(accountMenuSrc).toContain('accessibilityRole="button"');
    expect(accountMenuSrc).toContain('STRINGS.account.menuAccessibilityLabel');
    expect(accountMenuSrc).toContain('STRINGS.account.menuAccessibilityHint');
  });

  it('AccountMenu contains popover with Sign out and Delete account items', () => {
    expect(accountMenuSrc).toContain('STRINGS.account.signOutAction');
    expect(accountMenuSrc).toContain('STRINGS.account.deleteAccountAction');
    // Danger color for delete account
    expect(accountMenuSrc).toContain('color: colors.error');
  });

  it('AccountMenu enforces 2-step delete flow with DELETE input, password, and grace notice', () => {
    // Step 1: exact DELETE check
    expect(accountMenuSrc).toContain('deleteConfirmText.trim() !== \'DELETE\'');
    // Step 2: Password and Grace Period notice
    expect(accountMenuSrc).toContain('STRINGS.account.deleteGracePeriodNotice');
    expect(accountMenuSrc).toContain('STRINGS.account.deleteSubmitAction');
    expect(accountMenuSrc).toContain('authClient.deleteAccount(password)');
    // Handles upcoming tickets
    expect(accountMenuSrc).toContain('STRINGS.account.hasUpcomingTicketsError');
  });

  it('AccountMenu contains zero hardcoded hex literals (design tokens only)', () => {
    // Matches hex color codes (#xxx, #xxxxxx, #xxxxxxxx)
    const hexPattern = /#[0-9a-fA-F]{3,8}\b/;
    expect(accountMenuSrc).not.toMatch(hexPattern);
  });

  it('authClient provides deleteAccount and restoreAccount and maps error codes', () => {
    expect(authClientSrc).toContain('deleteAccount(password: string)');
    expect(authClientSrc).toContain('restoreAccount(email: string, password: string)');
    expect(authClientSrc).toContain("errorBody?.error?.code === 'ACCOUNT_SCHEDULED_FOR_DELETION'");
    expect(authClientSrc).toContain("errorBody?.error?.code === 'HAS_UPCOMING_TICKETS'");
  });

  it('MoviesHomeScreen integrates AccountMenu in headerRight', () => {
    expect(moviesHomeSrc).toContain('<AccountMenu onSignOut={onSignOut} />');
  });

  it('App.tsx subscribes to onScheduledForDeletion and provides restore account flow', () => {
    expect(appSrc).toContain('authClient.onScheduledForDeletion');
    expect(appSrc).toContain('STRINGS.account.restorePromptTitle');
    expect(appSrc).toContain('STRINGS.account.restorePromptMessage');
    expect(appSrc).toContain('STRINGS.account.restoreAction');
    expect(appSrc).toContain('authClient.restoreAccount(');
  });

  it('Dialog 1 and Dialog 2 use new wording, actions, and custom date formatting (Task A & B)', () => {
    expect(stringsSrc).toContain("deleteSuccessTitle: 'Account deletion started'");
    expect(stringsSrc).toContain('deleteSuccessAction: \'Got it\'');
    expect(stringsSrc).toContain("restorePromptTitle: 'Restore your account?'");
    expect(stringsSrc).toContain("restoreAction: 'Restore account'");
    expect(stringsSrc).toContain("cancelRestoreAction: 'Not now'");
    expect(stringsSrc).toContain('export function formatDeletableDate');
    expect(accountMenuSrc).toContain('STRINGS.account.deleteSuccessAction');
    expect(accountMenuSrc).not.toContain('toLocaleDateString');
    expect(appSrc).toContain('formatDeletableDate(scheduledDeletionInfo.purgeAfter)');
    expect(appSrc).not.toContain('toLocaleDateString');
  });

  it('SignInScreen suppresses form error banner for AccountScheduledForDeletionError (Task C)', () => {
    expect(signInSrc).toContain('AccountScheduledForDeletionError');
    expect(signInSrc).toContain('err instanceof AccountScheduledForDeletionError');
    expect(signInSrc).toContain('setFormError(null)');
  });
});
