import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Button, EmptyState, PhotoFade, QrCodeView, ScreenShell } from '../components';
import { useTheme } from '../context/ThemeContext';
import { STRINGS } from '../constants/strings';
import { TicketItem } from '../schemas/cinema';
import { cinemaClient } from '../api/cinemaClient';
import { getErrorCopy } from '../utils/error';

export interface TicketScreenProps {
  ticketId: string;
  initialTicket?: TicketItem;
  onBack: () => void;
}

export const TicketScreen: React.FC<TicketScreenProps> = ({
  ticketId,
  initialTicket,
  onBack,
}) => {
  const { colors, spacing, typography, radius } = useTheme();

  const [ticket, setTicket] = useState<TicketItem | null>(initialTicket || null);
  const [loadingTicket, setLoadingTicket] = useState<boolean>(!initialTicket);
  const [ticketError, setTicketError] = useState<unknown | null>(null);
  const [qrReference, setQrReference] = useState<string | null>(null);
  const [loadingQr, setLoadingQr] = useState<boolean>(true);
  const [qrError, setQrError] = useState<unknown | null>(null);

  // Fetch ticket details if not passed initially
  const loadTicketData = useCallback(async () => {
    if (initialTicket) {
      setTicket(initialTicket);
      return;
    }
    setLoadingTicket(true);
    setTicketError(null);
    try {
      const res = await cinemaClient.getUserTickets();
      const found = res.tickets.find((t) => t.id === ticketId);
      if (found) {
        setTicket(found);
      } else {
        setTicketError(new Error('NOT_FOUND'));
      }
    } catch (err: any) {
      setTicketError(err);
    } finally {
      setLoadingTicket(false);
    }
  }, [ticketId, initialTicket]);

  // Request fresh 256-bit QR reference each time screen opens (Task 6)
  // Reference kept in memory only; NEVER logged or persisted to disk
  const refreshQrReference = useCallback(async () => {
    setLoadingQr(true);
    setQrError(null);

    try {
      const res = await cinemaClient.generateTicketQr(ticketId);
      setQrReference(res.qrReference);
    } catch (err: any) {
      setQrError(err);
    } finally {
      setLoadingQr(false);
    }
  }, [ticketId]);

  useEffect(() => {
    loadTicketData();
    refreshQrReference();
  }, [loadTicketData, refreshQrReference]);

  const formatDateTime = (isoString?: string): string => {
    if (!isoString) return '';
    const d = new Date(isoString);
    return d.toLocaleString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <ScreenShell
      title={STRINGS.tickets.ticketDetailTitle}
      onBack={onBack}
      scrollable={true}
      contentContainerStyle={[styles.container, { padding: spacing.base }]}
    >
      {loadingTicket && !ticket ? (
        <View style={styles.centeredContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : !ticket ? (
        <View style={styles.centeredContainer}>
          {(() => {
            const errorCopy = getErrorCopy(ticketError);
            return (
              <EmptyState
                title={errorCopy.title}
                message={errorCopy.body}
                actionTitle={STRINGS.errors.tryAgain}
                onActionPress={loadTicketData}
              />
            );
          })()}
        </View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false}>
          {/* Booking Confirmed Photo Header (Task C) */}
          <PhotoFade
            source={require('../../assets/photos/booking-confirmed.jpg')}
            decorative
            style={[styles.confirmedPhoto, { borderRadius: radius.md, marginBottom: spacing.base }]}
          />

          {/* Main Ticket Card */}
          <View
            style={[
              styles.ticketCard,
              {
                backgroundColor: colors.surface_container_low,
                borderColor: colors.outline_variant,
                borderRadius: radius.lg || 16,
                padding: spacing.lg,
                marginBottom: spacing.base,
              },
            ]}
          >
            {/* Status Chip */}
            <View style={styles.statusRow}>
              <View
                style={[
                  styles.statusChip,
                  {
                    backgroundColor:
                      ticket.status === 'active'
                        ? colors.secondary_container
                        : ticket.status === 'used'
                          ? colors.surface_container_highest
                          : colors.error_container,
                    borderColor:
                      ticket.status === 'active'
                        ? colors.secondary
                        : ticket.status === 'used'
                          ? colors.outline
                          : colors.error,
                    borderRadius: radius.full || 9999,
                    paddingHorizontal: spacing.md,
                    paddingVertical: spacing.xs,
                  },
                ]}
              >
                <Text
                  allowFontScaling
                  style={[
                    styles.statusChipText,
                    {
                      color:
                        ticket.status === 'active'
                          ? colors.on_secondary_container
                          : ticket.status === 'used'
                            ? colors.on_surface_variant
                            : colors.on_error_container,
                      fontFamily: typography.labelSmall.fontFamily,
                      fontWeight: '700',
                    },
                  ]}
                >
                  {ticket.status === 'active'
                    ? STRINGS.tickets.activeStatus
                    : ticket.status === 'used'
                      ? STRINGS.tickets.usedStatus
                      : STRINGS.tickets.cancelledStatus}
                </Text>
              </View>

              {ticket.usedAt && (
                <Text
                  allowFontScaling
                  style={[
                    styles.usedAtText,
                    {
                      color: colors.on_surface_variant,
                      fontFamily: typography.bodySmall.fontFamily,
                    },
                  ]}
                >
                  {STRINGS.tickets.usedAtTime(formatDateTime(ticket.usedAt))}
                </Text>
              )}
            </View>

            {/* Cancelled Refund Line Notice (Task 6) */}
            {ticket.status === 'cancelled' && (
              <View
                style={[
                  styles.refundNoticeBox,
                  {
                    backgroundColor: colors.error_container,
                    borderRadius: radius.sm,
                    padding: spacing.sm,
                    marginTop: spacing.sm,
                  },
                ]}
              >
                <Text
                  allowFontScaling
                  style={[
                    styles.refundNoticeText,
                    {
                      color: colors.on_error_container,
                      fontFamily: typography.bodySmall.fontFamily,
                      fontSize: 12,
                    },
                  ]}
                >
                  {STRINGS.tickets.cancelledRefundNotice}
                </Text>
              </View>
            )}

            {/* Movie & Showtime Info */}
            <View style={{ marginTop: spacing.md }}>
              <Text
                allowFontScaling
                accessibilityRole="header"
                style={[
                  styles.movieTitle,
                  {
                    color: colors.on_surface,
                    fontFamily: typography.headlineSmall.fontFamily,
                    fontWeight: '700',
                  },
                ]}
              >
                {ticket.movieTitle || 'Movie Ticket'}
              </Text>
              <Text
                allowFontScaling
                style={[
                  styles.cinemaInfo,
                  {
                    color: colors.on_surface_variant,
                    fontFamily: typography.bodyMedium.fontFamily,
                    marginTop: 2,
                  },
                ]}
              >
                {ticket.cinemaName} • {ticket.hallName}
              </Text>
              <Text
                allowFontScaling
                style={[
                  styles.dateTimeInfo,
                  {
                    color: colors.primary,
                    fontFamily: typography.titleSmall.fontFamily,
                    fontWeight: '600',
                    marginTop: spacing.xs,
                  },
                ]}
              >
                📅 {formatDateTime(ticket.startsAt)}
              </Text>
            </View>

            {/* Seat & Booking Info Grid */}
            <View
              style={[
                styles.seatInfoBox,
                {
                  backgroundColor: colors.surface_container_high,
                  borderRadius: radius.md,
                  padding: spacing.md,
                  marginVertical: spacing.lg,
                },
              ]}
            >
              <View style={styles.metaCol}>
                <Text style={[styles.metaLabel, { color: colors.on_surface_variant }]}>ROW</Text>
                <Text style={[styles.metaVal, { color: colors.on_surface }]}>{ticket.row}</Text>
              </View>
              <View style={styles.metaCol}>
                <Text style={[styles.metaLabel, { color: colors.on_surface_variant }]}>SEAT</Text>
                <Text style={[styles.metaVal, { color: colors.on_surface }]}>{ticket.number}</Text>
              </View>
              <View style={styles.metaCol}>
                <Text style={[styles.metaLabel, { color: colors.on_surface_variant }]}>TICKET ID</Text>
                <Text numberOfLines={1} style={[styles.metaValSmall, { color: colors.on_surface }]}>
                  {ticket.id.slice(0, 8)}…
                </Text>
              </View>
            </View>

            {/* QR Code Container */}
            <View style={styles.qrContainer}>
              {loadingQr ? (
                <View style={styles.qrPlaceholder}>
                  <ActivityIndicator size="large" color={colors.primary} />
                </View>
              ) : qrError || !qrReference ? (
                <View style={styles.qrPlaceholder}>
                  {(() => {
                    const errorCopy = getErrorCopy(qrError);
                    return (
                      <EmptyState
                        title={errorCopy.title}
                        message={errorCopy.body}
                        actionTitle={STRINGS.errors.tryAgain}
                        onActionPress={refreshQrReference}
                        style={{ backgroundColor: 'transparent' }}
                      />
                    );
                  })()}
                </View>
              ) : (
                <View style={{ alignItems: 'center' }}>
                  <QrCodeView value={qrReference} size={180} />
                  <Text
                    allowFontScaling
                    style={[
                      styles.qrSecurityText,
                      {
                        color: colors.on_surface_variant,
                        fontFamily: typography.bodySmall.fontFamily,
                        fontSize: 11,
                        marginTop: spacing.sm,
                      },
                    ]}
                  >
                    {STRINGS.tickets.qrSecurityNote}
                  </Text>
                </View>
              )}
            </View>

            {/* Refresh QR button */}
            <Button
              title={STRINGS.tickets.qrRefreshAction}
              onPress={refreshQrReference}
              loading={loadingQr}
              variant="text"
              style={[styles.refreshBtn, { marginTop: spacing.md }]}
            />
          </View>
        </ScrollView>
      )}
    </ScreenShell>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centeredContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  ticketCard: {
    width: '100%',
    borderWidth: 1,
  },
  confirmedPhoto: {
    width: '100%',
    height: 160,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  statusChip: {
    borderWidth: 1,
  },
  statusChipText: {
    letterSpacing: 0.5,
  },
  usedAtText: {},
  refundNoticeBox: {
    width: '100%',
  },
  refundNoticeText: {
    textAlign: 'center',
  },
  movieTitle: {
    letterSpacing: -0.2,
  },
  cinemaInfo: {},
  dateTimeInfo: {},
  seatInfoBox: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
  },
  metaCol: {
    alignItems: 'center',
  },
  metaLabel: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  metaVal: {
    fontSize: 22,
    fontWeight: '700',
    marginTop: 2,
  },
  metaValSmall: {
    fontSize: 13,
    fontWeight: '600',
    marginTop: 6,
  },
  qrContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 220,
    width: '100%',
  },
  qrPlaceholder: {
    height: 180,
    justifyContent: 'center',
    alignItems: 'center',
  },
  qrSecurityText: {
    textAlign: 'center',
    paddingHorizontal: 16,
  },
  refreshBtn: {
    alignSelf: 'center',
    minHeight: 44,
  },
});

