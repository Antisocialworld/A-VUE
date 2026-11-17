import React, { useState } from 'react';
import { Image, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { Button, ScreenShell, SeatMap, Toast } from '../components';
import { useTheme } from '../context/ThemeContext';
import { STRINGS } from '../constants/strings';
import { HoldSeatsResponse, SeatMapItem, ShowtimeItem } from '../schemas/cinema';
import { cinemaClient } from '../api/cinemaClient';
import { formatKoboToNaira } from '../utils/money';
import { getDisplayMessage } from '../utils/error';

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
  onOpenWaitingRoom: (seatIds: string[], seats?: SeatMapItem[]) => void;
}

export const SeatMapScreen: React.FC<SeatMapScreenProps> = ({
  showtime,
  movieTitle,
  onBack,
  onProceedToCheckout,
  onOpenWaitingRoom,
}) => {
  const { colors, spacing, typography, radius } = useTheme();
  const { width: windowWidth } = useWindowDimensions();

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
      if (err.code === 'WAITING_ROOM_REQUIRED') {
        onOpenWaitingRoom(selectedSeatIds, selectedSeats);
      } else if (err.code === 'RATE_LIMIT_EXCEEDED') {
        setToastMessage(STRINGS.seatMap.rateLimitToast);
      } else if (err.code === 'SEAT_UNAVAILABLE' || err.status === 409) {
        setToastMessage(STRINGS.seatMap.conflictToast);
      } else if (err.status === 503) {
        setToastMessage(STRINGS.seatMap.serviceUnavailableToast);
      } else {
        setToastMessage(getDisplayMessage(err, STRINGS.common.genericError));
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

      {/* Middle Content: Background Photo (bottom 45% cropped) behind SeatMap */}
      <View style={styles.seatMapWrapper}>
        <View
          pointerEvents="none"
          style={[
            styles.photoContainer,
            {
              height: windowWidth * 0.34,
            },
          ]}
        >
          <Image
            source={require('../../assets/photos/seat-map.jpg')}
            accessibilityRole="image"
            accessibilityLabel={STRINGS.seatMap.photoAccessibilityLabel}
            style={styles.photoImage}
          />
          {/* Top edge fade into background token colour */}
          <Svg
            style={StyleSheet.absoluteFill}
            width="100%"
            height="100%"
            pointerEvents="none"
          >
            <Defs>
              <LinearGradient id="seatMapFade" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={colors.surface} stopOpacity="1" />
                <Stop offset="0.5" stopColor={colors.surface} stopOpacity="0.4" />
                <Stop offset="1" stopColor={colors.surface} stopOpacity="0" />
              </LinearGradient>
            </Defs>
            <Rect width="100%" height="100%" fill="url(#seatMapFade)" />
          </Svg>
          {/* Dimming overlay with token colour */}
          <View
            pointerEvents="none"
            style={[
              StyleSheet.absoluteFill,
              {
                backgroundColor: colors.scrim,
                opacity: 0.35,
              },
            ]}
          />
        </View>

        {/* Seat Map component */}
        <SeatMap
          showtimeId={showtime.id}
          selectedSeatIds={selectedSeatIds}
          onSelectionChange={handleSelectionChange}
          onToast={(msg) => setToastMessage(msg)}
        />
      </View>

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
  seatMapWrapper: {
    flex: 1,
    position: 'relative',
  },
  photoContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    overflow: 'hidden',
  },
  photoImage: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    width: '100%',
    aspectRatio: 1600 / 1203,
  },
});

