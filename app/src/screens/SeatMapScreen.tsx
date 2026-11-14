import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button, ScreenShell, SeatMap, Toast } from '../components';
import { useTheme } from '../context/ThemeContext';
import { STRINGS } from '../constants/strings';
import { HoldSeatsResponse, SeatMapItem, ShowtimeItem } from '../schemas/cinema';
import { cinemaClient } from '../api/cinemaClient';
import { formatKoboToNaira } from '../utils/money';

export interface SeatMapScreenProps {
  showtime: ShowtimeItem;
  movieTitle: string;
  onBack: () => void;
  onProceedToCheckout: (params: {
    showtime: ShowtimeItem;
    selectedSeatIds: string[];
    selectedSeats: SeatMapItem[];
    holdResponse: HoldSeatsResponse;
  }) => void;
  onOpenWaitingRoom: (seatIds: string[]) => void;
}

export const SeatMapScreen: React.FC<SeatMapScreenProps> = ({
  showtime,
  movieTitle,
  onBack,
  onProceedToCheckout,
  onOpenWaitingRoom,
}) => {
  const { colors, spacing, typography, radius } = useTheme();

  const [selectedSeatIds, setSelectedSeatIds] = useState<string[]>([]);
  const [selectedSeats, setSelectedSeats] = useState<SeatMapItem[]>([]);
  const [holding, setHolding] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const totalKobo = showtime.priceKobo * selectedSeatIds.length;

  const handleSelectionChange = (ids: string[], items: SeatMapItem[]) => {
    setSelectedSeatIds(ids);
    setSelectedSeats(items);
  };

  const handleHoldSeats = async () => {
    if (selectedSeatIds.length === 0 || holding) return;
    setHolding(true);

    try {
      const holdRes = await cinemaClient.holdSeats(showtime.id, selectedSeatIds);
      onProceedToCheckout({
        showtime,
        selectedSeatIds,
        selectedSeats,
        holdResponse: holdRes,
      });
    } catch (err: any) {
      if (err.code === 'WAITING_ROOM_REQUIRED' || err.status === 429) {
        onOpenWaitingRoom(selectedSeatIds);
      } else if (err.code === 'SEAT_UNAVAILABLE' || err.status === 409) {
        setToastMessage(STRINGS.seatMap.conflictToast);
      } else if (err.status === 503) {
        setToastMessage(STRINGS.seatMap.serviceUnavailableToast);
      } else {
        setToastMessage(err.message || STRINGS.common.genericError);
      }
    } finally {
      setHolding(false);
    }
  };

  return (
    <ScreenShell
      title={STRINGS.seatMap.title}
      onBack={onBack}
      scrollable={false}
      contentContainerStyle={[styles.container, { padding: 0 }]}
    >
      <Toast message={toastMessage} onDismiss={() => setToastMessage(null)} />

      {/* Mini info bar */}
      <View
        style={[
          styles.infoBar,
          {
            backgroundColor: colors.surface_container_low,
            borderBottomColor: colors.outline_variant,
            paddingHorizontal: spacing.base,
            paddingVertical: spacing.sm,
          },
        ]}
      >
        <Text
          allowFontScaling
          numberOfLines={1}
          style={[
            styles.infoBarTitle,
            {
              color: colors.on_surface,
              fontFamily: typography.titleSmall.fontFamily,
              fontSize: typography.titleSmall.fontSize,
              fontWeight: '600',
            },
          ]}
        >
          {movieTitle} • {showtime.cinemaName} ({showtime.hallName})
        </Text>
      </View>

      {/* Seat Map component */}
      <SeatMap
        showtimeId={showtime.id}
        selectedSeatIds={selectedSeatIds}
        onSelectionChange={handleSelectionChange}
        onToast={(msg) => setToastMessage(msg)}
      />

      {/* Sticky Bottom Action Bar */}
      <View
        style={[
          styles.bottomBar,
          {
            backgroundColor: colors.surface_container_low,
            borderTopColor: colors.outline_variant,
            padding: spacing.base,
          },
        ]}
      >
        <View style={styles.summaryRow}>
          <View>
            <Text
              allowFontScaling
              style={[
                styles.selectedCountText,
                {
                  color: colors.on_surface,
                  fontFamily: typography.titleSmall.fontFamily,
                  fontSize: typography.titleSmall.fontSize,
                  fontWeight: '700',
                },
              ]}
            >
              {STRINGS.seatMap.selectedCount(selectedSeatIds.length)}
            </Text>
            {selectedSeatIds.length > 0 && (
              <Text
                allowFontScaling
                style={[
                  styles.totalText,
                  {
                    color: colors.primary,
                    fontFamily: typography.labelLarge.fontFamily,
                    fontSize: typography.labelLarge.fontSize,
                    fontWeight: '700',
                    marginTop: 2,
                  },
                ]}
              >
                {formatKoboToNaira(totalKobo)}
              </Text>
            )}
          </View>

          <Button
            title={STRINGS.seatMap.proceedToCheckout}
            onPress={handleHoldSeats}
            disabled={selectedSeatIds.length === 0 || holding}
            loading={holding}
            variant="primary"
            style={styles.checkoutBtn}
          />
        </View>
      </View>
    </ScreenShell>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  infoBar: {
    width: '100%',
    borderBottomWidth: 1,
  },
  infoBarTitle: {},
  bottomBar: {
    width: '100%',
    borderTopWidth: 1,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  selectedCountText: {},
  totalText: {},
  checkoutBtn: {
    minWidth: 180,
    minHeight: 48,
  },
});

