import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Button, EmptyState, PhotoFade, ScreenShell } from '../components';
import { useTheme } from '../context/ThemeContext';
import { STRINGS } from '../constants/strings';
import {
  CheckoutResponse,
  HoldSeatsResponse,
  SeatMapItem,
  ShowtimeItem,
} from '../schemas/cinema';
import { cinemaClient } from '../api/cinemaClient';
import { openPaymentBrowser } from '../utils/browser';
import { generateIdempotencyKey } from '../utils/crypto';
import { formatKoboToNaira } from '../utils/money';

export interface CheckoutScreenProps {
  showtime: ShowtimeItem;
  selectedSeatIds: string[];
  selectedSeats: SeatMapItem[];
  holdResponse: HoldSeatsResponse;
  movieTitle: string;
  onBack: () => void;
  onPaymentSuccess: (ticketId: string) => void;
  onGoToMyTickets: () => void;
}

type CheckoutState =
  | 'idle'
  | 'initiating'
  | 'awaiting_payment'
  | 'confirming'
  | 'confirmation_timeout'
  | 'hold_expired'
  | 'payment_failed';

export const CheckoutScreen: React.FC<CheckoutScreenProps> = ({
  showtime,
  selectedSeatIds,
  selectedSeats,
  holdResponse,
  movieTitle,
  onBack,
  onPaymentSuccess,
  onGoToMyTickets,
}) => {
  const { colors, spacing, typography, radius } = useTheme();

  const [checkoutState, setCheckoutState] = useState<CheckoutState>('idle');
  const [checkoutData, setCheckoutData] = useState<CheckoutResponse | null>(null);
  const [isTestMode, setIsTestMode] = useState<boolean>(true);
  const [secondsLeft, setSecondsLeft] = useState<number>(() => {
    const expiryMs = new Date(holdResponse.expiresAt).getTime();
    const remaining = Math.max(0, Math.floor((expiryMs - Date.now()) / 1000));
    return remaining || holdResponse.holdTtlSeconds || 600;
  });
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // One idempotency key per checkout attempt, reused on retry of same attempt (Task 5)
  const idempotencyKeyRef = useRef<string>(generateIdempotencyKey());
  const confirmationTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isMountedRef = useRef<boolean>(true);

  // Fetch public checkout config for test mode badge (fail-safe to true)
  useEffect(() => {
    cinemaClient
      .getCheckoutConfig()
      .then((cfg) => {
        if (typeof cfg.testMode === 'boolean') {
          setIsTestMode(cfg.testMode);
        }
      })
      .catch(() => {
        setIsTestMode(true);
      });
  }, []);

  // Hold countdown timer
  useEffect(() => {
    const timer = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          setCheckoutState('hold_expired');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  const minutesLeft = Math.floor(secondsLeft / 60);
  const secondsRemain = secondsLeft % 60;

  // Release seats helper
  const handleReleaseSeats = async () => {
    try {
      await cinemaClient.releaseSeats(showtime.id, selectedSeatIds);
    } catch {
      // Ignore release error
    } finally {
      onBack();
    }
  };

  // Poll for ticket confirmation (up to 60s)
  const pollForConfirmation = async () => {
    setCheckoutState('confirming');
    const startTime = Date.now();
    const MAX_POLL_MS = 60000; // 60s max per Task 5

    const checkTickets = async () => {
      if (!isMountedRef.current) return;

      try {
        const ticketRes = await cinemaClient.getUserTickets();
        const foundTicket = ticketRes.tickets.find(
          (t) => t.showtimeId === showtime.id && t.status === 'active'
        );

        if (foundTicket) {
          if (confirmationTimerRef.current) clearInterval(confirmationTimerRef.current);
          onPaymentSuccess(foundTicket.id);
          return;
        }
      } catch {
        // Polling retry
      }

      if (Date.now() - startTime >= MAX_POLL_MS) {
        if (confirmationTimerRef.current) clearInterval(confirmationTimerRef.current);
        setCheckoutState('confirmation_timeout');
      }
    };

    confirmationTimerRef.current = setInterval(checkTickets, 3000);
    // Initial probe
    checkTickets();
  };

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (confirmationTimerRef.current) clearInterval(confirmationTimerRef.current);
    };
  }, []);

  // Initiate checkout
  const handlePay = async () => {
    setCheckoutState('initiating');
    setErrorMessage(null);

    try {
      // Reuse same idempotency key for this attempt
      const res = await cinemaClient.checkout(
        showtime.id,
        selectedSeatIds,
        idempotencyKeyRef.current
      );
      setCheckoutData(res);
      setCheckoutState('awaiting_payment');

      // Open Flutterwave hosted link
      await openPaymentBrowser(res.paymentLink);

      // Once user returns to app, begin polling for ticket confirmation
      pollForConfirmation();
    } catch (err: any) {
      setErrorMessage(err.message || STRINGS.common.genericError);
      setCheckoutState('idle');
    }
  };

  // Formatted price calculations
  const rawTicketsKobo = showtime.priceKobo * selectedSeatIds.length;
  const estimatedFeeKobo = Math.round((rawTicketsKobo * 500) / 10000); // 5% fee estimate
  const ticketsAmountKobo = checkoutData ? checkoutData.amountKobo - checkoutData.feeKobo : rawTicketsKobo;
  const feeAmountKobo = checkoutData ? checkoutData.feeKobo : estimatedFeeKobo;
  const totalAmountKobo = checkoutData ? checkoutData.amountKobo : ticketsAmountKobo + feeAmountKobo;

  // Render State: Hold Expired
  if (checkoutState === 'hold_expired') {
    return (
      <ScreenShell title={STRINGS.checkout.title} onBack={onBack} scrollable={false}>
        <View style={styles.centeredContainer}>
          <EmptyState
            title={STRINGS.checkout.holdExpiredTitle}
            message={STRINGS.checkout.holdExpiredMessage}
            actionTitle={STRINGS.common.retry}
            onActionPress={onBack}
          />
        </View>
      </ScreenShell>
    );
  }

  // Render State: Confirming
  if (checkoutState === 'confirming') {
    return (
      <ScreenShell title={STRINGS.checkout.title} scrollable={false}>
        <View style={styles.centeredContainer}>
          <ActivityIndicator size="large" color={colors.primary} style={{ marginBottom: spacing.lg }} />
          <Text
            allowFontScaling
            accessibilityRole="header"
            style={[styles.stateTitle, { color: colors.on_surface, fontFamily: typography.titleLarge.fontFamily }]}
          >
            {STRINGS.checkout.confirmingPaymentTitle}
          </Text>
          <Text
            allowFontScaling
            style={[
              styles.stateMessage,
              { color: colors.on_surface_variant, fontFamily: typography.bodyMedium.fontFamily, marginVertical: spacing.md },
            ]}
          >
            {STRINGS.checkout.confirmingPaymentMessage}
          </Text>
        </View>
      </ScreenShell>
    );
  }

  // Render State: Confirmation Timeout (60s exceeded)
  if (checkoutState === 'confirmation_timeout') {
    return (
      <ScreenShell title={STRINGS.checkout.title} scrollable={false}>
        <View style={styles.centeredContainer}>
          <EmptyState
            title={STRINGS.checkout.confirmingPaymentTitle}
            message={STRINGS.checkout.confirmationStillPending}
            actionTitle={STRINGS.checkout.viewMyTicketsAction}
            onActionPress={onGoToMyTickets}
          />
        </View>
      </ScreenShell>
    );
  }

  const seatsLabel = selectedSeats.map((s) => `${s.row}${s.number}`).join(', ');
  const showTestModeBadge = checkoutData?.testMode ?? isTestMode;

  return (
    <ScreenShell
      title={STRINGS.checkout.title}
      onBack={handleReleaseSeats}
      scrollable={true}
      contentContainerStyle={[styles.container, { padding: spacing.base }]}
    >
      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Checkout Header Photo (Task C) */}
        <PhotoFade
          source={require('../../assets/photos/checkout.jpg')}
          decorative
          style={[styles.headerPhoto, { borderRadius: radius.md, marginBottom: spacing.md }]}
        />

        {/* TEST MODE BADGE (Shown only in test mode, fail-safe to true if missing) */}
        {showTestModeBadge ? (
          <View style={styles.badgeWrapper}>
            <View
              style={[
                styles.badgePill,
                {
                  backgroundColor: colors.secondary_container,
                  borderColor: colors.secondary,
                  borderRadius: radius.full || 9999,
                  paddingHorizontal: spacing.md,
                  paddingVertical: spacing.xs,
                },
              ]}
            >
              <Text
                allowFontScaling
                style={[
                  styles.badgeText,
                  {
                    color: colors.on_secondary_container,
                    fontFamily: typography.labelSmall.fontFamily,
                    fontWeight: '700',
                  },
                ]}
              >
                {STRINGS.checkout.testModeBadge}
              </Text>
            </View>
          </View>
        ) : null}

        {/* Hold Countdown Timer */}
        <View
          style={[
            styles.countdownBanner,
            {
              backgroundColor: colors.surface_container_high,
              borderColor: colors.outline_variant,
              borderRadius: radius.md,
              padding: spacing.md,
              marginVertical: spacing.md,
            },
          ]}
        >
          <Text
            allowFontScaling
            style={[
              styles.countdownText,
              {
                color: secondsLeft < 120 ? colors.error : colors.primary,
                fontFamily: typography.labelLarge.fontFamily,
                fontWeight: '700',
                textAlign: 'center',
              },
            ]}
          >
            ⏱ {STRINGS.checkout.holdCountdown(minutesLeft, secondsRemain)}
          </Text>
        </View>

        {/* Showtime & Seats Details Card */}
        <View
          style={[
            styles.detailsCard,
            {
              backgroundColor: colors.surface_container_low,
              borderColor: colors.outline_variant,
              borderRadius: radius.md,
              padding: spacing.base,
              marginBottom: spacing.base,
            },
          ]}
        >
          <Text
            allowFontScaling
            accessibilityRole="header"
            style={[
              styles.cardTitle,
              {
                color: colors.on_surface,
                fontFamily: typography.titleLarge.fontFamily,
                fontWeight: '700',
              },
            ]}
          >
            {movieTitle}
          </Text>
          <Text
            allowFontScaling
            style={[
              styles.cardSubtitle,
              {
                color: colors.on_surface_variant,
                fontFamily: typography.bodyMedium.fontFamily,
                marginTop: 2,
              },
            ]}
          >
            {showtime.cinemaName} • {showtime.hallName}
          </Text>

          <View style={[styles.seatRow, { marginTop: spacing.md }]}>
            <Text
              allowFontScaling
              style={[
                styles.seatRowLabel,
                {
                  color: colors.on_surface_variant,
                  fontFamily: typography.bodySmall.fontFamily,
                },
              ]}
            >
              Seats:
            </Text>
            <Text
              allowFontScaling
              style={[
                styles.seatRowValue,
                {
                  color: colors.on_surface,
                  fontFamily: typography.titleSmall.fontFamily,
                  fontWeight: '600',
                  marginLeft: spacing.xs,
                },
              ]}
            >
              {seatsLabel}
            </Text>
          </View>
        </View>

        {/* Server-Returned Price Lines Breakdown */}
        <View
          style={[
            styles.priceCard,
            {
              backgroundColor: colors.surface_container_low,
              borderColor: colors.outline_variant,
              borderRadius: radius.md,
              padding: spacing.base,
              marginBottom: spacing.base,
            },
          ]}
        >
          <Text
            allowFontScaling
            accessibilityRole="header"
            style={[
              styles.priceHeader,
              {
                color: colors.on_surface,
                fontFamily: typography.titleMedium.fontFamily,
                fontWeight: '600',
                marginBottom: spacing.md,
              },
            ]}
          >
            {STRINGS.checkout.priceBreakdownHeader}
          </Text>

          {/* Tickets line */}
          <View style={styles.priceLine}>
            <Text
              allowFontScaling
              style={[styles.priceLabel, { color: colors.on_surface_variant, fontFamily: typography.bodyMedium.fontFamily }]}
            >
              {STRINGS.checkout.ticketsLine(selectedSeatIds.length)}
            </Text>
            <Text
              allowFontScaling
              style={[styles.priceVal, { color: colors.on_surface, fontFamily: typography.bodyMedium.fontFamily, fontWeight: '600' }]}
            >
              {formatKoboToNaira(ticketsAmountKobo)}
            </Text>
          </View>

          {/* Service Fee line */}
          <View style={[styles.priceLine, { marginTop: spacing.xs }]}>
            <Text
              allowFontScaling
              style={[styles.priceLabel, { color: colors.on_surface_variant, fontFamily: typography.bodyMedium.fontFamily }]}
            >
              {STRINGS.checkout.serviceFeeLine}
            </Text>
            <Text
              allowFontScaling
              style={[styles.priceVal, { color: colors.on_surface, fontFamily: typography.bodyMedium.fontFamily, fontWeight: '600' }]}
            >
              {formatKoboToNaira(feeAmountKobo)}
            </Text>
          </View>

          <View style={[styles.divider, { backgroundColor: colors.outline_variant, marginVertical: spacing.md }]} />

          {/* Total Line */}
          <View style={styles.priceLine}>
            <Text
              allowFontScaling
              style={[styles.totalLabel, { color: colors.on_surface, fontFamily: typography.titleMedium.fontFamily, fontWeight: '700' }]}
            >
              {STRINGS.checkout.totalLine}
            </Text>
            <Text
              allowFontScaling
              style={[styles.totalVal, { color: colors.primary, fontFamily: typography.titleLarge.fontFamily, fontWeight: '700' }]}
            >
              {formatKoboToNaira(totalAmountKobo)}
            </Text>
          </View>
        </View>

        {/* Cancellation Auto-Refund Policy Notice */}
        <Text
          allowFontScaling
          style={[
            styles.policyNotice,
            {
              color: colors.on_surface_variant,
              fontFamily: typography.bodySmall.fontFamily,
              fontSize: typography.bodySmall.fontSize,
              lineHeight: typography.bodySmall.lineHeight,
              marginBottom: spacing.xl,
            },
          ]}
        >
          {STRINGS.checkout.cancellationRefundPolicy}
        </Text>

        {errorMessage && (
          <Text
            allowFontScaling
            accessibilityRole="alert"
            style={[styles.errorText, { color: colors.error, marginBottom: spacing.md, textAlign: 'center' }]}
          >
            {errorMessage}
          </Text>
        )}

        {/* Action Buttons */}
        <Button
          title={STRINGS.checkout.payWithFlutterwave}
          onPress={handlePay}
          loading={checkoutState === 'initiating'}
          variant="primary"
          style={styles.payBtn}
        />

        <Button
          title={STRINGS.checkout.releaseSeatsAction}
          onPress={handleReleaseSeats}
          variant="text"
          style={[styles.releaseBtn, { marginTop: spacing.sm }]}
        />
      </ScrollView>
    </ScreenShell>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  headerPhoto: {
    width: '100%',
    height: 160,
  },
  centeredContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  badgeWrapper: {
    alignItems: 'center',
    width: '100%',
  },
  badgePill: {
    borderWidth: 1,
  },
  badgeText: {
    letterSpacing: 1,
  },
  countdownBanner: {
    width: '100%',
    borderWidth: 1,
  },
  countdownText: {},
  detailsCard: {
    width: '100%',
    borderWidth: 1,
  },
  cardTitle: {
    letterSpacing: -0.2,
  },
  cardSubtitle: {},
  seatRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  seatRowLabel: {},
  seatRowValue: {},
  priceCard: {
    width: '100%',
    borderWidth: 1,
  },
  priceHeader: {},
  priceLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  priceLabel: {},
  priceVal: {},
  divider: {
    height: 1,
    width: '100%',
  },
  totalLabel: {},
  totalVal: {},
  policyNotice: {
    textAlign: 'center',
    paddingHorizontal: 8,
  },
  errorText: {},
  payBtn: {
    width: '100%',
    minHeight: 48,
  },
  releaseBtn: {
    width: '100%',
    minHeight: 44,
  },
  stateTitle: {
    textAlign: 'center',
  },
  stateMessage: {
    textAlign: 'center',
  },
});

