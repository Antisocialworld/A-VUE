import React, { useImperativeHandle, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useTheme } from '../context/ThemeContext';
import { STRINGS } from '../constants/strings';
import { assistantClient, AssistantHistoryItem, AssistantMovie } from '../api/assistantClient';
import { AssistantMovieCard, AssistantMovieViewDetailsParams } from './AssistantMovieCard';

type ChatRole = 'user' | 'assistant';

export interface ChatMessage {
  id: string;
  role: ChatRole;
  text: string;
  movie?: AssistantMovie;
}

/** Imperative handle so the host header can clear the chat's local error/thinking state. */
export interface AssistantChatHandle {
  clear: () => void;
}

export interface AssistantChatProps {
  /** Controlled by MainNavigator on native/narrow; optional so the web panel keeps its own state. */
  messages?: ChatMessage[];
  setMessages?: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  onSessionExpired: () => void;
  onOpenMovie?: (params: AssistantMovieViewDetailsParams) => void;
}

const MAX_MESSAGE_LENGTH = 300;

function mapAssistantError(error: unknown): string {
  const err = error as
    | { status?: number; code?: string; name?: string; message?: string }
    | null
    | undefined;
  const status = typeof err?.status === 'number' ? err.status : undefined;
  const code = typeof err?.code === 'string' ? err.code : undefined;
  const name = typeof err?.name === 'string' ? err.name : undefined;
  const message = typeof err?.message === 'string' ? err.message.toLowerCase() : '';

  if (status === 401 || code === 'UNAUTHORIZED') {
    return '';
  }
  if (status === 429 || code === 'RATE_LIMIT_EXCEEDED') {
    return STRINGS.assistant.errors.tooMany;
  }
  if (status === 400 || code === 'VALIDATION_ERROR') {
    return STRINGS.assistant.errors.badRequest;
  }
  // The client turns an aborted request into a named timeout error with status 0.
  if (
    name === 'AbortError' ||
    name === 'TimeoutError' ||
    message.includes('timed out') ||
    message.includes('timeout')
  ) {
    return STRINGS.assistant.errors.timeout;
  }
  if (
    status === 0 ||
    message.includes('fetch failed') ||
    message.includes('failed to fetch') ||
    message.includes('network request failed') ||
    message.includes('could not connect') ||
    message.includes('connection refused')
  ) {
    return STRINGS.assistant.errors.offline;
  }
  if (
    (status !== undefined && status >= 500) ||
    code === 'SERVICE_UNAVAILABLE' ||
    code === 'BAD_GATEWAY'
  ) {
    return STRINGS.assistant.errors.serviceFailure;
  }
  return STRINGS.assistant.errors.generic;
}

/** One shared chat implementation used by the full screen and the wide-web panel. */
const AssistantChatView = (
  {
    messages: messagesProp,
    setMessages: setMessagesProp,
    onSessionExpired,
    onOpenMovie,
  }: AssistantChatProps,
  ref: React.ForwardedRef<AssistantChatHandle>,
) => {
  const { colors, spacing, typography, radius } = useTheme();
  // Web panel is deliberately left uncontrolled (web work is paused); native/narrow is controlled.
  const [localMessages, setLocalMessages] = useState<ChatMessage[]>([]);
  const messages = messagesProp ?? localMessages;
  const setMessages = setMessagesProp ?? setLocalMessages;
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [isTyping, setIsTyping] = useState(false);
  const listRef = useRef<FlatList<ChatMessage>>(null);
  const nextIdRef = useRef(
    messages.reduce((max, m) => Math.max(max, Number(m.id.slice(2)) || 0), 0) + 1,
  );
  // Bumped by the header's Clear action: an in-flight reply from an older generation is dropped.
  const generationRef = useRef(0);
  useImperativeHandle(ref, () => ({
    clear: () => {
      generationRef.current += 1;
      setInlineError(null);
      setSending(false);
      setIsTyping(false);
    },
  }));

  const suggestions = useMemo(
    () => [
      STRINGS.assistant.suggestions.refundPolicy,
      STRINGS.assistant.suggestions.openingHours,
      STRINGS.assistant.suggestions.ageRatings,
    ],
    [],
  );

  const canSend = input.trim().length > 0 && !sending;

  const scrollToEnd = () => {
    requestAnimationFrame(() => {
      listRef.current?.scrollToEnd({ animated: true });
    });
  };

  const sendMessage = async (rawText: string) => {
    const text = rawText.trim();
    if (!text || sending) return;
    if (text.length > MAX_MESSAGE_LENGTH) return;

    // Snapshot the generation before awaiting: Clear invalidates it so this reply is dropped.
    const generation = generationRef.current;
    const history: AssistantHistoryItem[] = messages.slice(-4).map((m) => ({
      role: m.role,
      text: m.text,
    }));

    const userMessage: ChatMessage = {
      id: `m-${nextIdRef.current++}`,
      role: 'user',
      text,
    };

    setMessages((prev) => [...prev, userMessage]);
    setInlineError(null);
    setSending(true);
    setIsTyping(true);
    setTimeout(scrollToEnd, 50);

    try {
      const result = await assistantClient.sendChat({ message: text, history });
      if (generation !== generationRef.current) return; // cleared while in flight
      const assistantMessage: ChatMessage = {
        id: `m-${nextIdRef.current++}`,
        role: 'assistant',
        text: result.reply,
        movie: result.movie,
      };
      setMessages((prev) => [...prev, assistantMessage]);
      setInput('');
      setTimeout(scrollToEnd, 50);
    } catch (error: unknown) {
      if (generation !== generationRef.current) return; // cleared while in flight
      // Remove the failed user bubble so no unanswered turn remains in thread or next-request history.
      setMessages((prev) => prev.filter((m) => m.id !== userMessage.id));
      setInput((prev) => (prev.trim().length === 0 ? text : prev));
      const err = error as { status?: number; code?: string } | null | undefined;
      if (err?.status === 401 || err?.code === 'UNAUTHORIZED') {
        onSessionExpired();
        return;
      }
      setInlineError(mapAssistantError(error));
    } finally {
      // Do not resurrect the thinking state for a reply that was cleared (or superseded).
      if (generation === generationRef.current) {
        setSending(false);
        setIsTyping(false);
      }
    }
  };

  const renderMessage = ({ item }: { item: ChatMessage }) => {
    const isUser = item.role === 'user';
    return (
      <View
        style={[
          styles.messageRow,
          { justifyContent: isUser ? 'flex-end' : 'flex-start', marginBottom: spacing.sm },
        ]}
      >
        <View
          style={[
            styles.bubble,
            {
              maxWidth: '82%',
              borderRadius: radius.lg,
              paddingHorizontal: spacing.md,
              paddingVertical: spacing.sm,
              backgroundColor: isUser ? colors.primary : colors.surface_container_high,
            },
          ]}
        >
          <Text
            allowFontScaling
            selectable={Platform.OS !== 'web'}
            style={[
              styles.messageText,
              {
                color: isUser ? colors.on_primary : colors.on_surface,
                fontFamily: typography.bodyMedium.fontFamily,
                fontSize: typography.bodyMedium.fontSize,
                lineHeight: typography.bodyMedium.lineHeight,
              },
            ]}
          >
            {item.text}
          </Text>
          {item.movie ? (
            <AssistantMovieCard movie={item.movie} onViewDetails={onOpenMovie} />
          ) : null}
        </View>
      </View>
    );
  };

  const renderEmpty = () => (
    <View style={{ paddingTop: spacing.sm }}>
      <View style={styles.suggestionsRow}>
        {suggestions.map((label) => (
          <Pressable
            key={label}
            accessibilityRole="button"
            accessibilityLabel={label}
            onPress={() => sendMessage(label)}
            disabled={sending}
            style={({ pressed }) => [
              styles.chip,
              {
                borderColor: colors.outline_variant,
                backgroundColor: pressed ? colors.surface_container_high : colors.surface_container_low,
                borderRadius: radius.full,
                paddingHorizontal: spacing.md,
                paddingVertical: spacing.sm,
                minHeight: 44,
                opacity: sending ? 0.6 : 1,
              },
            ]}
          >
            <Text
              allowFontScaling
              style={{
                color: colors.on_surface,
                fontFamily: typography.labelMedium.fontFamily,
                fontSize: typography.labelMedium.fontSize,
              }}
            >
              {label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View
        style={[
          styles.noticeBanner,
          {
            backgroundColor: colors.warning_container,
            paddingHorizontal: spacing.base,
            paddingVertical: spacing.sm,
          },
        ]}
      >
        <Text
          allowFontScaling
          accessibilityRole="text"
          style={{
            color: colors.on_warning_container,
            fontFamily: typography.bodySmall.fontFamily,
            fontSize: typography.bodySmall.fontSize,
            lineHeight: typography.bodySmall.lineHeight,
          }}
        >
          {STRINGS.assistant.notice}
        </Text>
      </View>

      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(item) => item.id}
        renderItem={renderMessage}
        contentContainerStyle={{
          paddingHorizontal: spacing.base,
          paddingTop: spacing.base,
          paddingBottom: spacing.md,
          flexGrow: 1,
        }}
        ListHeaderComponent={messages.length === 0 ? renderEmpty : undefined}
        ListFooterComponent={
          isTyping ? (
            <View style={[styles.messageRow, { justifyContent: 'flex-start', marginTop: spacing.xs }]}>
              <View
                accessibilityLabel={STRINGS.assistant.typing}
                style={[
                  styles.bubble,
                  {
                    borderRadius: radius.lg,
                    paddingHorizontal: spacing.md,
                    paddingVertical: spacing.sm,
                    backgroundColor: colors.surface_container_high,
                    minHeight: 44,
                    justifyContent: 'center',
                  },
                ]}
              >
                <Text
                  allowFontScaling
                  style={{
                    color: colors.on_surface_variant,
                    fontFamily: typography.bodyMedium.fontFamily,
                    fontSize: typography.bodyMedium.fontSize,
                  }}
                >
                  {STRINGS.assistant.typing}
                </Text>
              </View>
            </View>
          ) : undefined
        }
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={scrollToEnd}
      />

      <View
        style={[
          styles.inputArea,
          {
            borderTopColor: colors.outline_variant,
            backgroundColor: colors.surface,
            paddingHorizontal: spacing.base,
            paddingTop: spacing.sm,
            paddingBottom: spacing.base,
          },
        ]}
      >
        {inlineError ? (
          <Text
            allowFontScaling
            accessibilityRole="alert"
            style={{
              color: colors.error,
              fontFamily: typography.bodySmall.fontFamily,
              fontSize: typography.bodySmall.fontSize,
              marginBottom: spacing.xs,
            }}
          >
            {inlineError}
            {' '}
            {STRINGS.assistant.errors.messageStillInBox}
          </Text>
        ) : null}

        <View style={[styles.inputRow, { gap: spacing.sm }]}>
          <View
            style={[
              styles.inputWrap,
              {
                borderColor: colors.outline_variant,
                backgroundColor: colors.surface_container_lowest,
                borderRadius: radius.md,
                paddingHorizontal: spacing.md,
                paddingVertical: spacing.xs,
                minHeight: 48,
              },
            ]}
          >
            <TextInput
              value={input}
              onChangeText={(text) => {
                setInput(text.slice(0, MAX_MESSAGE_LENGTH));
                if (inlineError) setInlineError(null);
              }}
              placeholder={STRINGS.assistant.inputPlaceholder}
              placeholderTextColor={colors.outline}
              accessibilityLabel={STRINGS.assistant.inputLabel}
              multiline
              autoCorrect
              spellCheck
              autoCapitalize="sentences"
              maxLength={MAX_MESSAGE_LENGTH}
              editable={!sending}
              style={[
                styles.textInput,
                {
                  color: colors.on_surface,
                  fontFamily: typography.bodyLarge.fontFamily,
                  fontSize: typography.bodyLarge.fontSize,
                  maxHeight: 100,
                },
              ]}
              onSubmitEditing={() => {
                if (canSend) sendMessage(input);
              }}
              blurOnSubmit={false}
            />
            <Text
              allowFontScaling
              accessibilityLabel={`${input.length} of ${MAX_MESSAGE_LENGTH} characters`}
              style={{
                color: colors.on_surface_variant,
                fontFamily: typography.labelSmall.fontFamily,
                fontSize: typography.labelSmall.fontSize,
                alignSelf: 'flex-end',
              }}
            >
              {input.length}/{MAX_MESSAGE_LENGTH}
            </Text>
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={STRINGS.assistant.sendAction}
            accessibilityState={{ disabled: !canSend }}
            disabled={!canSend}
            onPress={() => sendMessage(input)}
            style={({ pressed }) => [
              styles.sendButton,
              {
                width: 48,
                height: 48,
                borderRadius: 24,
                backgroundColor: canSend ? colors.primary : colors.surface_container_highest,
                opacity: pressed && canSend ? 0.85 : 1,
              },
            ]}
          >
            <Svg width={22} height={22} viewBox="0 0 24 24" fill="none" accessible={false}>
              <Path
                d="M3.5 20.5L21 12L3.5 3.5L3.5 10.5L15 12L3.5 13.5L3.5 20.5Z"
                fill={canSend ? colors.on_primary : colors.outline}
              />
            </Svg>
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
};

/** Ref allows the host header to reset local chat state without lifting it into the navigator. */
export const AssistantChat = React.forwardRef<AssistantChatHandle, AssistantChatProps>(
  AssistantChatView,
);

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  noticeBanner: {
    width: '100%',
  },
  messageRow: {
    width: '100%',
    flexDirection: 'row',
  },
  bubble: {
    minHeight: 44,
  },
  messageText: {
    flexShrink: 1,
  },
  suggestionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  inputArea: {
    borderTopWidth: 1,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  inputWrap: {
    flex: 1,
    borderWidth: 1,
  },
  textInput: {
    padding: 0,
    margin: 0,
    textAlignVertical: 'top',
  },
  sendButton: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
