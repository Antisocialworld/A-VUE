import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { PhotoFade, ScreenShell } from '../components';
import { useTheme } from '../context/ThemeContext';
import { STRINGS } from '../constants/strings';
import { cinemaClient } from '../api/cinemaClient';
import { getDisplayMessage } from '../utils/error';

export interface WaitingRoomScreenProps {
  showtimeId: string;
  onAdmitted: (pass: string) => void;
  onBack: () => void;
  pollIntervalMs?: number;
}

export const WaitingRoomScreen: React.FC<WaitingRoomScreenProps> = ({
  showtimeId,
  onAdmitted,
  onBack,
  pollIntervalMs = 3000,
}) => {
  const { colors, spacing, typography, radius } = useTheme();

  const [position, setPosition] = useState<number | undefined>(undefined);
  const [isAdmitted, setIsAdmitted] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const isMountedRef = useRef<boolean>(true);

  useEffect(() => {
    isMountedRef.current = true;

    const checkWaitingRoom = async () => {
      try {
        const data = await cinemaClient.getWaitingRoomStatus(showtimeId);
        if (!isMountedRef.current) return;

        if (data.status === 'admitted' && data.pass) {
          setIsAdmitted(true);
          onAdmitted(data.pass);
          return;
        }

        setPosition(data.position);
      } catch (err: any) {
        if (!isMountedRef.current) return;
        setErrorMessage(getDisplayMessage(err, STRINGS.common.genericError));
      }
    };

    // Initial check
    checkWaitingRoom();

    // Poll every 3 seconds
    const interval = setInterval(checkWaitingRoom, pollIntervalMs);

    return () => {
      isMountedRef.current = false;
      clearInterval(interval);
    };
  }, [showtimeId, onAdmitted, pollIntervalMs]);

  return (
    <ScreenShell
      title={STRINGS.waitingRoom.title}
      onBack={onBack}
      scrollable={false}
      contentContainerStyle={[styles.container, { padding: spacing.xl }]}
    >
      <View
        style={[
          styles.card,
          {
            backgroundColor: colors.surface_container_low,
            borderColor: colors.outline_variant,
            borderRadius: radius.md,
            padding: spacing.xl,
          },
        ]}
      >
        <PhotoFade
          source={require('../../assets/photos/waiting-room.jpg')}
          decorative
          style={[styles.headerPhoto, { borderRadius: radius.sm, marginBottom: spacing.lg }]}
        />
        <ActivityIndicator size="large" color={colors.primary} style={{ marginBottom: spacing.lg }} />

        <Text
          allowFontScaling
          accessibilityRole="header"
          accessibilityLabel={isAdmitted ? STRINGS.waitingRoom.admittedMessage : STRINGS.waitingRoom.title}
          style={[
            styles.titleText,
            {
              color: colors.on_surface,
              fontFamily: typography.titleLarge.fontFamily,
              fontSize: typography.titleLarge.fontSize,
              fontWeight: typography.titleLarge.fontWeight,
            },
          ]}
        >
          {isAdmitted ? STRINGS.waitingRoom.admittedMessage : STRINGS.waitingRoom.title}
        </Text>

        <Text
          allowFontScaling
          accessibilityLabel={STRINGS.waitingRoom.subtitle}
          style={[
            styles.subtitleText,
            {
              color: colors.on_surface_variant,
              fontFamily: typography.bodyMedium.fontFamily,
              fontSize: typography.bodyMedium.fontSize,
              marginVertical: spacing.md,
            },
          ]}
        >
          {STRINGS.waitingRoom.subtitle}
        </Text>

        {position !== undefined && (
          <View
            style={[
              styles.statBox,
              {
                backgroundColor: colors.surface_container_high,
                borderRadius: radius.sm,
                padding: spacing.md,
                marginTop: spacing.sm,
              },
            ]}
          >
            <Text
              allowFontScaling
              accessibilityLabel={STRINGS.waitingRoom.rankLabel}
              style={[
                styles.statLabel,
                {
                  color: colors.on_surface_variant,
                  fontFamily: typography.labelMedium.fontFamily,
                  fontSize: typography.labelMedium.fontSize,
                },
              ]}
            >
              {STRINGS.waitingRoom.rankLabel}
            </Text>
            <Text
              allowFontScaling
              accessibilityLabel={`${STRINGS.waitingRoom.rankLabel}: ${position}`}
              style={[
                styles.statValue,
                {
                  color: colors.primary,
                  fontFamily: typography.headlineMedium.fontFamily,
                  fontSize: typography.headlineMedium.fontSize,
                  fontWeight: '700',
                  marginTop: 2,
                },
              ]}
            >
              #{position}
            </Text>
          </View>
        )}

        <Text
          allowFontScaling
          accessibilityLabel={STRINGS.waitingRoom.spotOpensMessage}
          style={[
            styles.calmNoticeText,
            {
              color: colors.on_surface_variant,
              fontFamily: typography.bodySmall.fontFamily,
              fontSize: typography.bodySmall.fontSize,
              marginTop: spacing.md,
            },
          ]}
        >
          {STRINGS.waitingRoom.spotOpensMessage}
        </Text>

        {errorMessage && (
          <Text
            allowFontScaling
            accessibilityRole="alert"
            accessibilityLabel={errorMessage}
            style={[
              styles.errorText,
              {
                color: colors.error,
                fontFamily: typography.bodySmall.fontFamily,
                fontSize: typography.bodySmall.fontSize,
                marginTop: spacing.md,
              },
            ]}
          >
            {errorMessage}
          </Text>
        )}
      </View>
    </ScreenShell>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  card: {
    width: '100%',
    maxWidth: 400,
    borderWidth: 1,
    alignItems: 'center',
    textAlign: 'center',
  },
  headerPhoto: {
    width: '100%',
    height: 140,
  },
  titleText: {
    textAlign: 'center',
    letterSpacing: -0.2,
  },
  subtitleText: {
    textAlign: 'center',
  },
  statBox: {
    width: '100%',
    alignItems: 'center',
  },
  statLabel: {},
  statValue: {},
  calmNoticeText: {
    textAlign: 'center',
  },
  errorText: {
    textAlign: 'center',
  },
});

