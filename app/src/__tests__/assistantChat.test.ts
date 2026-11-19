import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { shouldUseAssistantPanel } from '../utils/assistantLayout';
import { STRINGS } from '../constants/strings';

const clientPath = path.resolve(__dirname, '../api/assistantClient.ts');
const chatPath = path.resolve(__dirname, '../components/AssistantChat.tsx');
const cardPath = path.resolve(__dirname, '../components/AssistantMovieCard.tsx');
const screenPath = path.resolve(__dirname, '../screens/AskAssistantScreen.tsx');
const panelPath = path.resolve(__dirname, '../components/AssistantPanel.tsx');

describe('Ask A VUE app chat failure handling', () => {
  it('assistant client request timeout is 27 s to outlast the 25 s server worst case', () => {
    const src = fs.readFileSync(clientPath, 'utf-8');
    expect(src).toContain('setTimeout(() => controller.abort(), 27000)');
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

    expect(screenSrc).toContain('messages={messages}');
    expect(screenSrc).toContain('setMessages={setMessages}');
    expect(screenSrc).toContain('onSessionExpired={onSessionExpired}');
    expect(screenSrc).toContain('onOpenMovie={onOpenMovie}');
    // Web overlay is paused: its chat mount stays uncontrolled and unchanged.
    expect(panelSrc).toContain(
      '<AssistantChat onSessionExpired={onSessionExpired} onOpenMovie={onOpenMovie} />',
    );
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

describe('Ask A VUE chat history lifetime and Movie Detail return route', () => {
  const appSrc = fs.readFileSync(path.resolve(__dirname, '../../App.tsx'), 'utf-8');
  const chatSrc = fs.readFileSync(chatPath, 'utf-8');
  const screenSrc = fs.readFileSync(screenPath, 'utf-8');
  const panelSrc = fs.readFileSync(panelPath, 'utf-8');

  function mount(name: string): string {
    const match = appSrc.match(new RegExp(`<${name}[\\s\\S]*?/>`));
    expect(match).not.toBeNull();
    return match![0];
  }

  it('keeps messages in parent state and passes them into the controlled chat', () => {
    expect(chatSrc).toContain('export interface ChatMessage');
    expect(chatSrc).toContain('messages?: ChatMessage[];');
    expect(chatSrc).toContain('setMessages?: React.Dispatch<React.SetStateAction<ChatMessage[]>>;');
    expect(chatSrc).toContain('const messages = messagesProp ?? localMessages;');
    expect(chatSrc).toContain('const setMessages = setMessagesProp ?? setLocalMessages;');

    // Existing limits and session flow are untouched.
    expect(chatSrc).toContain('const MAX_MESSAGE_LENGTH = 300;');
    expect(chatSrc).toContain('setInput(text.slice(0, MAX_MESSAGE_LENGTH))');
    expect(chatSrc).toContain('const history: AssistantHistoryItem[] = messages.slice(-4).map((m) => ({');
    expect(chatSrc).toContain('onSessionExpired();');

    expect(appSrc).toContain(
      'const [assistantMessages, setAssistantMessages] = useState<ChatMessage[]>([]);',
    );
    expect(screenSrc).toContain('messages: ChatMessage[];');
    expect(screenSrc).toContain('setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;');
    const askMount = mount('AskAssistantScreen');
    expect(askMount).toContain('messages={assistantMessages}');
    expect(askMount).toContain('setMessages={setAssistantMessages}');
  });

  it('clears in-memory history on sign-out, session expiry and the account-delete sign-out path', () => {
    const signOut = appSrc.match(/const handleSignOut = async \(\) => \{([\s\S]*?)\n  \};/);
    expect(signOut).not.toBeNull();
    expect(signOut![1]).toContain('setAssistantMessages([]);');

    const expired = appSrc.match(/const handleAssistantSessionExpired = \(\) => \{([\s\S]*?)\n  \};/);
    expect(expired).not.toBeNull();
    expect(expired![1]).toContain('setAssistantMessages([]);');

    // AccountMenu's final delete step calls onSignOut, which is handleSignOut here.
    const accountMenuSrc = fs.readFileSync(
      path.resolve(__dirname, '../components/AccountMenu.tsx'),
      'utf-8',
    );
    const moviesHomeSrc = fs.readFileSync(
      path.resolve(__dirname, '../screens/MoviesHomeScreen.tsx'),
      'utf-8',
    );
    expect(accountMenuSrc).toContain('onSignOut();');
    expect(moviesHomeSrc).toContain('<AccountMenu onSignOut={onSignOut} />');
    expect(mount('MoviesHomeScreen')).toContain('onSignOut={handleSignOut}');
  });

  it('remembers ask_assistant only for the chat card and honours it on Back', () => {
    const cardHandler = appSrc.match(/const handleOpenAssistantMovie[\s\S]*?\n  \};/);
    expect(cardHandler).not.toBeNull();
    expect(cardHandler![0]).toContain('handleSelectMovie(params);');
    expect(cardHandler![0]).toContain("if (!useAssistantPanel) setMovieDetailReturnRoute('ask_assistant');");
    expect(mount('AskAssistantScreen')).toContain('onOpenMovie={handleOpenAssistantMovie}');

    expect(mount('MoviesHomeScreen')).toContain('onSelectMovie={handleSelectMovie}');
    expect(mount('SearchScreen')).toContain('onSelectMovie={handleSelectMovie}');
    expect(mount('MoviesHomeScreen')).not.toContain('ask_assistant');
    expect(mount('SearchScreen')).not.toContain('ask_assistant');

    const detailMount = mount('MovieDetailScreen');
    expect(detailMount).toContain('const returnRoute = movieDetailReturnRoute;');
    expect(detailMount).toContain("setMovieDetailReturnRoute('movies');");
    expect(detailMount).toContain('setCurrentRoute(returnRoute);');

    // Wide-web overlay stays untouched and uncontrolled.
    expect(panelSrc).toContain('onOpenMovie={onOpenMovie}');
    expect(panelSrc).not.toContain('messages=');
  });
});

describe('C1 — Clear chat action', () => {
  const screenSrc = fs.readFileSync(screenPath, 'utf-8');
  const chatSrc = fs.readFileSync(chatPath, 'utf-8');

  function from(src: string, marker: string): string {
    const at = src.indexOf(marker);
    expect(at).toBeGreaterThanOrEqual(0);
    return src.slice(at);
  }

  it('sources the visible label and accessibility label from the strings file', () => {
    expect(STRINGS.assistant.clearAction).toBe('Clear chat');
    expect(STRINGS.assistant.clearActionAccessibilityLabel).toBe('Clear chat');
    expect(screenSrc).toContain('{STRINGS.assistant.clearAction}');
    expect(screenSrc).toContain(
      'accessibilityLabel={STRINGS.assistant.clearActionAccessibilityLabel}',
    );
  });

  it('renders a ghost action in the header right only when a message exists', () => {
    expect(screenSrc).toContain('const headerRight =');
    expect(screenSrc).toContain('messages.length > 0 ? (');
    expect(screenSrc).toContain(') : undefined;');
    expect(screenSrc).toContain('headerRight={headerRight}');
    expect(screenSrc).toContain('accessibilityRole="button"');
    expect(screenSrc).toContain('onPress={handleClearChat}');
    // Ghost style uses token colours; target is at least 44pt.
    expect(screenSrc).toContain('color: colors.primary_text');
    expect(screenSrc).toContain('minHeight: 44');
    expect(screenSrc).toContain('minWidth: 44');
    expect(screenSrc).toContain('ref={chatRef}');
  });

  it('clears messages and resets error/thinking without a server call or route change', () => {
    const handler = from(screenSrc, 'const handleClearChat').split('\n  };')[0];
    expect(handler).toContain('setMessages([]);');
    expect(handler).toContain('chatRef.current?.clear();');
    expect(handler).not.toContain('assistantClient');
    expect(handler).not.toContain('sendChat');
    expect(handler).not.toContain('fetch(');
    expect(handler).not.toContain('setCurrentRoute');
    expect(handler).not.toContain('ReturnRoute');

    const clear = from(chatSrc, 'useImperativeHandle').split('}));')[0];
    expect(clear).toContain('clear: () => {');
    expect(clear).toContain('generationRef.current += 1;');
    expect(clear).toContain('setInlineError(null);');
    expect(clear).toContain('setSending(false);');
    expect(clear).toContain('setIsTyping(false);');
    // Input text may stay after a clear.
    expect(clear).not.toContain('setInput(');
  });

  it('drops a late reply after clearing via the generation counter', () => {
    const send = from(chatSrc, 'const sendMessage').split('\n  };')[0];
    expect(send).toContain('const generation = generationRef.current;');
    expect(send.match(/generation !== generationRef\.current/g)).toHaveLength(2); // success + failure
    expect(send).toContain('if (generation === generationRef.current) {');

    // The guard precedes both message append paths, and the finally cannot resurrect thinking.
    const success = send.slice(send.indexOf('const result = await assistantClient.sendChat'));
    expect(success.indexOf('if (generation !== generationRef.current) return;')).toBeLessThan(
      success.indexOf('setMessages((prev) => [...prev, assistantMessage]);'),
    );
    const failure = send.slice(send.indexOf('} catch (error: unknown) {'));
    expect(failure.indexOf('if (generation !== generationRef.current) return;')).toBeLessThan(
      failure.indexOf('setMessages((prev) => prev.filter('),
    );
    expect(from(send, '} finally {')).toContain('if (generation === generationRef.current) {');
  });
});

describe('C2 — iOS keyboard suggestions on the chat input', () => {
  const chatSrc = fs.readFileSync(chatPath, 'utf-8');

  it('enables autoCorrect, spellCheck and sentence capitalisation without custom correction logic', () => {
    const inputStart = chatSrc.indexOf('<TextInput');
    const input = chatSrc.slice(inputStart, chatSrc.indexOf('/>', inputStart));
    expect(input).toContain('autoCorrect');
    expect(input).toContain('spellCheck');
    expect(input).toContain('autoCapitalize="sentences"');
    // Keyboard props stay at React Native defaults; no custom correction code was added.
    expect(input).not.toContain('keyboardType=');
    expect(input).not.toContain('onTextInput');
    expect(chatSrc).not.toContain('replaceText');
  });
});

describe('C3a — selectable message and movie card text', () => {
  const chatSrc = fs.readFileSync(chatPath, 'utf-8');
  const cardSrc = fs.readFileSync(cardPath, 'utf-8');

  it('makes every user and assistant bubble selectable on native', () => {
    const bubble = chatSrc.slice(chatSrc.indexOf('selectable={Platform.OS'), chatSrc.indexOf('{item.text}'));
    expect(bubble).toContain('selectable={Platform.OS !== \'web\'}');
    expect(chatSrc.match(/selectable=\{Platform\.OS !== 'web'\}/g)).toHaveLength(1);
  });

  it('makes card title, year and overview selectable on native', () => {
    expect(cardSrc.match(/selectable=\{Platform\.OS !== 'web'\}/g)).toHaveLength(4); // title, year, overview, poster fallback title
    expect(cardSrc).toContain(
      "import { Alert, Image, Platform, Pressable, StyleSheet, Text, View } from 'react-native';",
    );
  });

  it('leaves the View details button and its label interactive, and defines no card tap', () => {
    const button = cardSrc.slice(
      cardSrc.indexOf('accessibilityRole="button"'),
      cardSrc.indexOf('{STRINGS.assistant.movie.viewDetails}'),
    );
    expect(button).toContain('onPress={handleViewDetails}');
    expect(button).not.toContain('selectable');
    expect(cardSrc).not.toContain('onPress={handleCardPress}');

    // Exactly one long press: on the poster Pressable, never on the View details button.
    expect(cardSrc.match(/onLongPress=/g)).toHaveLength(1);
    const posterPressable = cardSrc.slice(
      cardSrc.indexOf('<Pressable'),
      cardSrc.indexOf('</Pressable>'),
    );
    expect(posterPressable).toContain(
      "onLongPress={Platform.OS !== 'web' ? handlePosterLongPress : undefined}",
    );
    expect(button).not.toContain('onLongPress');
  });
});
