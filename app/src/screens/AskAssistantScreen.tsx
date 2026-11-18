import React from 'react';
import { StyleSheet } from 'react-native';
import { AssistantChat, ScreenShell } from '../components';
import { STRINGS } from '../constants/strings';

export interface AskAssistantScreenProps {
  onBack: () => void;
  onSessionExpired: () => void;
}

/** Narrow-web and native full-screen host; chat logic lives in AssistantChat. */
export const AskAssistantScreen: React.FC<AskAssistantScreenProps> = ({
  onBack,
  onSessionExpired,
}) => (
  <ScreenShell
    title={STRINGS.assistant.title}
    onBack={onBack}
    scrollable={false}
    contentContainerStyle={[styles.container, { padding: 0 }]}
  >
    <AssistantChat onSessionExpired={onSessionExpired} />
  </ScreenShell>
);

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
