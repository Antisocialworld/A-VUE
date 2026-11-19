import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { AssistantChat, ScreenShell } from '../components';
import type {
  AssistantChatHandle,
  AssistantMovieViewDetailsParams,
  ChatMessage,
} from '../components';
import { STRINGS } from '../constants/strings';
import { useTheme } from '../context/ThemeContext';

export interface AskAssistantScreenProps {
  onBack: () => void;
  onSessionExpired: () => void;
  messages: ChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  onOpenMovie?: (params: AssistantMovieViewDetailsParams) => void;
}

/** Narrow-web and native full-screen host; chat logic lives in AssistantChat. */
export const AskAssistantScreen: React.FC<AskAssistantScreenProps> = ({
  onBack,
  onSessionExpired,
  messages,
  setMessages,
  onOpenMovie,
}) => {
  const { colors, spacing, typography } = useTheme();
  const chatRef = React.useRef<AssistantChatHandle>(null);

  const handleClearChat = () => {
    // Messages live in MainNavigator; local error/thinking state lives in AssistantChat.
    setMessages([]);
    chatRef.current?.clear();
  };

  const headerRight =
    messages.length > 0 ? (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={STRINGS.assistant.clearActionAccessibilityLabel}
        onPress={handleClearChat}
        style={({ pressed }) => [
          styles.clearButton,
          { paddingHorizontal: spacing.sm, opacity: pressed ? 0.6 : 1 },
        ]}
      >
        <Text
          allowFontScaling
          style={{
            color: colors.primary_text,
            fontFamily: typography.labelLarge.fontFamily,
            fontSize: typography.labelLarge.fontSize,
          }}
        >
          {STRINGS.assistant.clearAction}
        </Text>
      </Pressable>
    ) : undefined;

  return (
    <ScreenShell
      title={STRINGS.assistant.title}
      onBack={onBack}
      headerRight={headerRight}
      scrollable={false}
      contentContainerStyle={[styles.container, { padding: spacing.none }]}
    >
      <AssistantChat
        ref={chatRef}
        messages={messages}
        setMessages={setMessages}
        onSessionExpired={onSessionExpired}
        onOpenMovie={onOpenMovie}
      />
    </ScreenShell>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  clearButton: {
    minHeight: 44,
    minWidth: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
