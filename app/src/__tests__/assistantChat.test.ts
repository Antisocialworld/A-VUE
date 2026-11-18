import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { shouldUseAssistantPanel } from '../utils/assistantLayout';
import { STRINGS } from '../constants/strings';

const clientPath = path.resolve(__dirname, '../api/assistantClient.ts');
const chatPath = path.resolve(__dirname, '../components/AssistantChat.tsx');
const screenPath = path.resolve(__dirname, '../screens/AskAssistantScreen.tsx');
const panelPath = path.resolve(__dirname, '../components/AssistantPanel.tsx');

describe('Ask A VUE app chat failure handling', () => {
  it('assistant client request timeout is 25 s to outlast server fallback window', () => {
    const src = fs.readFileSync(clientPath, 'utf-8');
    expect(src).toContain('setTimeout(() => controller.abort(), 25000)');
  });

  it('failed send removes the user bubble, restores input only when empty, and keeps failed turn out of next request history', () => {
    const src = fs.readFileSync(chatPath, 'utf-8');

    // Failed user bubble is removed from thread so it is never left unanswered in UI/history.
    expect(src).toContain('setMessages((prev) => prev.filter((m) => m.id !== userMessage.id))');

    // Restore failed text into input only if empty; never append/overwrite if user typed something new.
    expect(src).toContain('setInput((prev) => (prev.trim().length === 0 ? text : prev))');
    expect(src).not.toContain('setInput(text);');

    // Next request history is built from existing thread messages (not including the failed attempt).
    expect(src).toContain('const history: AssistantHistoryItem[] = messages.slice(-4).map((m) => ({');
    expect(src).toContain('setMessages((prev) => [...prev, userMessage]);');
  });

  it('keeps the always-visible privacy notice banner and removes duplicate empty-state notice text', () => {
    const src = fs.readFileSync(chatPath, 'utf-8');
    expect(src).toContain('{STRINGS.assistant.notice}');
    expect(src).toContain('colors.warning_container');
    expect(src).toContain('colors.on_warning_container');
    expect(src).not.toContain("marginBottom: spacing.md,\n        }}\n      >\n        {STRINGS.assistant.notice}\n      </Text>");
  });

  it('shares one chat component between the full screen and the wide-web panel', () => {
    const screenSrc = fs.readFileSync(screenPath, 'utf-8');
    const panelSrc = fs.readFileSync(panelPath, 'utf-8');
    const chatSrc = fs.readFileSync(chatPath, 'utf-8');

    expect(screenSrc).toContain('<AssistantChat onSessionExpired={onSessionExpired} />');
    expect(panelSrc).toContain('<AssistantChat onSessionExpired={onSessionExpired} />');
    expect(screenSrc).not.toContain('const sendMessage');
    expect(panelSrc).not.toContain('const sendMessage');
    expect(chatSrc).toContain('export const AssistantChat');
  });

  it('uses the supported absolute fill style in the web panel', () => {
    const panelSrc = fs.readFileSync(panelPath, 'utf-8');

    expect(panelSrc).toContain('...StyleSheet.absoluteFill');
    expect(panelSrc).not.toContain('absoluteFillObject');
  });

  it('uses the new friendly 429 copy for rate limits', () => {
    expect(STRINGS.assistant.errors.tooMany).toBe('Ask A VUE is busy right now. Try again shortly.');
    expect(STRINGS.assistant.errors.tooMany.toLowerCase()).not.toContain('wait a minute');
    expect(fs.readFileSync(chatPath, 'utf-8')).toContain('return STRINGS.assistant.errors.tooMany;');
  });

  it('opens a panel only on web at 900 or wider', () => {
    expect(shouldUseAssistantPanel('web', 899)).toBe(false);
    expect(shouldUseAssistantPanel('web', 900)).toBe(true);
    expect(shouldUseAssistantPanel('ios', 1440)).toBe(false);
    expect(shouldUseAssistantPanel('android', 1440)).toBe(false);
  });
});
