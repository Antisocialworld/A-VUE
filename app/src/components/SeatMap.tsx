import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  AppState,
  AppStateStatus,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { STRINGS } from '../constants/strings';
import { MAX_SEATS_PER_BOOKING, SeatMapItem, SeatState } from '../schemas/cinema';
import { cinemaClient } from '../api/cinemaClient';
import { triggerSeatSelectHaptic } from '../utils/haptics';

export { MAX_SEATS_PER_BOOKING };

export interface SeatMapProps {
  showtimeId: string;
  selectedSeatIds: string[];
  onSelectionChange: (selectedIds: string[], selectedSeats: SeatMapItem[]) => void;
  onToast: (message: string) => void;
  pollIntervalMs?: number;
}

export const SeatMap: React.FC<SeatMapProps> = ({
  showtimeId,
  selectedSeatIds,
  onSelectionChange,
  onToast,
  pollIntervalMs = 4000,
}) => {
  const { colors, spacing, typography, radius } = useTheme();
  const { width: windowWidth } = useWindowDimensions();

  const [seats, setSeats] = useState<SeatMapItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [isScreenReaderActive, setIsScreenReaderActive] = useState<boolean>(false);
  const [isZoomed, setIsZoomed] = useState<boolean>(false);

  // App state tracking for foreground polling
  const appStateRef = useRef<AppStateStatus>((AppState.currentState as AppStateStatus) || 'active');

  // Check screen reader status
  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isScreenReaderEnabled().then((enabled) => {
      if (mounted) setIsScreenReaderActive(enabled);
    });

    const sub = AccessibilityInfo.addEventListener('screenReaderChanged', (enabled) => {
      if (mounted) setIsScreenReaderActive(enabled);
    });

    return () => {
      mounted = false;
      sub?.remove?.();
    };
  }, []);

  // Track app active state
  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState) => {
      appStateRef.current = nextState;
    });
    return () => sub.remove();
  }, []);

  // Fetch & reconcile seats
  const fetchSeats = useCallback(
    async (isPolling = false) => {
      if (!isPolling) setLoading(true);
      setError(null);

      try {
        const data = await cinemaClient.getSeatMap(showtimeId);
        const newSeats = data.seats;

        setSeats((prevSeats) => {
          // If polling, reconcile selected seats with new statuses
          if (isPolling && selectedSeatIds.length > 0) {
            const newlyUnavailableSeats: SeatMapItem[] = [];
            const remainingSelectedIds: string[] = [];

            for (const seat of newSeats) {
              if (selectedSeatIds.includes(seat.id)) {
                if (seat.state === 'held' || seat.state === 'sold') {
                  newlyUnavailableSeats.push(seat);
                } else {
                  remainingSelectedIds.push(seat.id);
                }
              }
            }

            if (newlyUnavailableSeats.length > 0) {
              const label = newlyUnavailableSeats
                .map((s) => `Row ${s.row}-${s.number}`)
                .join(', ');
              onToast(STRINGS.seatMap.seatDeselectedToast(label));

              const remainingSeats = newSeats.filter((s) =>
                remainingSelectedIds.includes(s.id)
              );
              onSelectionChange(remainingSelectedIds, remainingSeats);
            }
          }
          return newSeats;
        });
      } catch (err: any) {
        if (!isPolling) {
          setError(err.message || STRINGS.common.genericError);
        }
      } finally {
        if (!isPolling) setLoading(false);
      }
    },
    [showtimeId, selectedSeatIds, onSelectionChange, onToast]
  );

  // Initial fetch
  useEffect(() => {
    fetchSeats(false);
  }, [showtimeId]);

  // Polling loop: every 4 seconds while active and focused
  useEffect(() => {
    const interval = setInterval(() => {
      if (appStateRef.current === 'active') {
        fetchSeats(true);
      }
    }, pollIntervalMs);

    return () => clearInterval(interval);
  }, [fetchSeats, pollIntervalMs]);

  // Group seats by row
  const rowGroups = useMemo(() => {
    const groups: Record<string, SeatMapItem[]> = {};
    for (const seat of seats) {
      if (!groups[seat.row]) {
        groups[seat.row] = [];
      }
      groups[seat.row].push(seat);
    }
    // Sort seats in each row by number
    for (const r of Object.keys(groups)) {
      groups[r].sort((a, b) => a.number - b.number);
    }
    return groups;
  }, [seats]);

  const rows = useMemo(() => Object.keys(rowGroups).sort(), [rowGroups]);

  // Widest row seat count calculated dynamically from data (no hardcoded 10)
  const maxSeatsInRow = useMemo(() => {
    let max = 0;
    for (const r of Object.keys(rowGroups)) {
      if (rowGroups[r].length > max) {
        max = rowGroups[r].length;
      }
    }
    return Math.max(max, 1);
  }, [rowGroups]);

  // Fit-to-width cell dimensions calculated from window width, padding, row-label column, and widest row
  const screenHorizontalPadding = spacing.base * 2;
  const rowLabelColumnWidth = isZoomed ? 24 : 14;
  const availableSeatsWidth = Math.max(0, windowWidth - screenHorizontalPadding - rowLabelColumnWidth);
  const rawSeatCellWidth = availableSeatsWidth / maxSeatsInRow;
  const cellWidth = Math.floor(rawSeatCellWidth);
  const fitMargin = Math.max(1.5, Math.min(3, Math.floor(cellWidth * 0.08)));
  const fitSeatSize = Math.max(14, Math.min(32, cellWidth - fitMargin * 2));

  // Handle seat tap
  const handleSeatPress = (seat: SeatMapItem) => {
    if (seat.state !== 'available') return;

    // If not zoomed and screen reader is not active, tap zooms into that area
    if (!isZoomed && !isScreenReaderActive) {
      setIsZoomed(true);
      return;
    }

    const isCurrentlySelected = selectedSeatIds.includes(seat.id);

    if (isCurrentlySelected) {
      // Deselect
      const updated = selectedSeatIds.filter((id) => id !== seat.id);
      const updatedSeats = seats.filter((s) => updated.includes(s.id));
      onSelectionChange(updated, updatedSeats);
      triggerSeatSelectHaptic();
    } else {
      // Check max limit
      if (selectedSeatIds.length >= MAX_SEATS_PER_BOOKING) {
        onToast(STRINGS.seatMap.maxSeatsReached);
        return;
      }
      const updated = [...selectedSeatIds, seat.id];
      const updatedSeats = seats.filter((s) => updated.includes(s.id));
      onSelectionChange(updated, updatedSeats);
      triggerSeatSelectHaptic();
    }
  };

  // Render Seat Visual Node with distinct shape & colour per state
  const renderSeatVisual = (seat: SeatMapItem, is44PtTarget = false) => {
    const isSelected = selectedSeatIds.includes(seat.id);

    let bgColor = colors.surface_container_high;
    let borderColor = colors.outline_variant;
    let borderWidth = 1;
    let borderStyle: 'solid' | 'dashed' = 'solid';
    let borderRadiusVal: number = radius.sm;
    let stateLabel: string = STRINGS.seatMap.availableLegend;

    if (seat.accessible) {
      // Wheelchair shape: fully rounded circle
      borderRadiusVal = 9999;
    }

    if (seat.state === 'sold') {
      bgColor = colors.surface_container_lowest;
      borderColor = colors.outline;
      borderWidth = 1.5;
      stateLabel = STRINGS.seatMap.soldLegend;
    } else if (seat.state === 'held') {
      bgColor = colors.surface_container;
      borderColor = colors.outline;
      borderStyle = 'dashed';
      borderWidth = 1.5;
      stateLabel = STRINGS.seatMap.heldLegend;
    } else if (isSelected) {
      // Selected: high-contrast primary token
      bgColor = colors.primary;
      borderColor = colors.primary_text_high;
      borderWidth = 2;
      borderRadiusVal = seat.accessible ? 9999 : radius.sm;
      stateLabel = STRINGS.seatMap.selectedLegend;
    }

    const seatSize = is44PtTarget ? 44 : isZoomed ? 38 : fitSeatSize;
    const margin = is44PtTarget ? 4 : isZoomed ? 3 : fitMargin;

    return (
      <Pressable
        key={seat.id}
        onPress={() => handleSeatPress(seat)}
        disabled={seat.state === 'sold' || seat.state === 'held'}
        accessibilityRole="button"
        accessibilityLabel={STRINGS.seatMap.seatAccessibilityLabel(
          seat.row,
          seat.number,
          stateLabel,
          seat.accessible
        )}
        accessibilityState={{
          selected: isSelected,
          disabled: seat.state === 'sold' || seat.state === 'held',
        }}
        style={[
          styles.seatBase,
          {
            width: seatSize,
            height: seatSize,
            margin,
            backgroundColor: bgColor,
            borderColor,
            borderWidth,
            borderStyle,
            borderRadius: borderRadiusVal,
          },
        ]}
      >
        {is44PtTarget || isZoomed ? (
          <Text
            allowFontScaling={false}
            style={[
              styles.seatNumberText,
              {
                color: isSelected ? colors.on_primary : colors.on_surface,
                fontFamily: typography.labelSmall.fontFamily,
                fontSize: 10,
              },
            ]}
          >
            {seat.number}
          </Text>
        ) : null}
      </Pressable>
    );
  };

  return (
    <View style={styles.container}>
      {/* Screen Indicator Bar */}
      <View style={[styles.screenBarWrapper, { marginVertical: spacing.md }]}>
        <View
          style={[
            styles.screenBar,
            {
              backgroundColor: colors.surface_container_highest,
              borderColor: colors.primary,
            },
          ]}
        />
        <Text
          allowFontScaling
          accessibilityRole="header"
          style={[
            styles.screenLabel,
            {
              color: colors.on_surface_variant,
              fontFamily: typography.labelSmall.fontFamily,
              fontSize: typography.labelSmall.fontSize,
              marginTop: spacing.xs,
            },
          ]}
        >
          {STRINGS.seatMap.screenIndicator}
        </Text>
      </View>

      {/* Legend showing shape and colour distinctions */}
      <View style={[styles.legendRow, { paddingHorizontal: spacing.base, marginBottom: spacing.md }]}>
        <View style={styles.legendItem}>
          <View style={[styles.legendChip, { backgroundColor: colors.surface_container_high, borderRadius: 4 }]} />
          <Text style={[styles.legendText, { color: colors.on_surface_variant }]}>
            {STRINGS.seatMap.availableLegend}
          </Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendChip, { backgroundColor: colors.primary, borderRadius: 4 }]} />
          <Text style={[styles.legendText, { color: colors.on_surface_variant }]}>
            {STRINGS.seatMap.selectedLegend}
          </Text>
        </View>
        <View style={styles.legendItem}>
          <View
            style={[
              styles.legendChip,
              {
                backgroundColor: colors.surface_container,
                borderColor: colors.outline,
                borderStyle: 'dashed',
                borderWidth: 1.5,
                borderRadius: 4,
              },
            ]}
          />
          <Text style={[styles.legendText, { color: colors.on_surface_variant }]}>
            {STRINGS.seatMap.heldLegend}
          </Text>
        </View>
        <View style={styles.legendItem}>
          <View
            style={[
              styles.legendChip,
              { backgroundColor: colors.surface_container_lowest, borderColor: colors.outline, borderWidth: 1.5, borderRadius: 4 },
            ]}
          />
          <Text style={[styles.legendText, { color: colors.on_surface_variant }]}>
            {STRINGS.seatMap.soldLegend}
          </Text>
        </View>
        <View style={styles.legendItem}>
          <View
            style={[
              styles.legendChip,
              { backgroundColor: colors.surface_container_high, borderRadius: 9999, borderWidth: 1.5, borderColor: colors.primary },
            ]}
          />
          <Text style={[styles.legendText, { color: colors.on_surface_variant }]}>
            {STRINGS.seatMap.wheelchairLegend}
          </Text>
        </View>
      </View>

      {/* Zoom Mode Toggle Button (if screen reader not active) */}
      {!isScreenReaderActive && (
        <View style={{ alignItems: 'center', marginBottom: spacing.base }}>
          <Pressable
            onPress={() => setIsZoomed((z) => !z)}
            accessibilityRole="button"
            accessibilityLabel={isZoomed ? 'Zoom out to fit all seats' : 'Zoom in for large 44 pt touch targets'}
            style={[
              styles.zoomToggleBtn,
              {
                backgroundColor: colors.surface_container_low,
                borderColor: colors.outline_variant,
                borderRadius: radius.md,
                paddingHorizontal: spacing.md,
                paddingVertical: spacing.xs,
              },
            ]}
          >
            <Text
              allowFontScaling
              style={[
                styles.zoomToggleText,
                {
                  color: colors.primary,
                  fontFamily: typography.labelMedium.fontFamily,
                  fontSize: typography.labelMedium.fontSize,
                },
              ]}
            >
              {isZoomed ? 'Fit scale (overview)' : 'Zoom in (44 pt targets)'}
            </Text>
          </Pressable>

          {!isZoomed && (
            <Text
              allowFontScaling
              style={[
                styles.zoomHintText,
                {
                  color: colors.on_surface_variant,
                  fontFamily: typography.bodySmall.fontFamily,
                  fontSize: typography.bodySmall.fontSize,
                  marginTop: spacing.sm,
                },
              ]}
            >
              {STRINGS.seatMap.zoomHint}
            </Text>
          )}
        </View>
      )}

      {/* Seat Map Content */}
      {isScreenReaderActive ? (
        // Screen Reader Mode: Horizontally scrollable lines with 44 pt touch targets
        <ScrollView style={styles.screenReaderScroll}>
          {rows.map((rowName) => (
            <View key={rowName} style={styles.accessibleRowContainer}>
              <Text style={[styles.rowHeader, { color: colors.on_surface, width: 32 }]}>
                {rowName}
              </Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.accessibleRowScroll}>
                {rowGroups[rowName]?.map((seat) => renderSeatVisual(seat, true))}
              </ScrollView>
            </View>
          ))}
        </ScrollView>
      ) : (
        // Visual Grid: Scrollable when zoomed; centered when fit
        <ScrollView
          horizontal
          nestedScrollEnabled
          contentContainerStyle={[
            styles.gridContentContainer,
            {
              justifyContent: isZoomed ? 'flex-start' : 'center',
              paddingHorizontal: spacing.base,
              paddingBottom: spacing.xxl,
            },
          ]}
        >
          <ScrollView nestedScrollEnabled showsVerticalScrollIndicator={false}>
            {rows.map((rowName) => (
              <View key={rowName} style={styles.gridRow}>
                <Text
                  style={[
                    styles.rowHeader,
                    {
                      color: colors.on_surface_variant,
                      width: rowLabelColumnWidth,
                      fontSize: isZoomed ? 12 : 9,
                    },
                  ]}
                >
                  {rowName}
                </Text>
                <View style={styles.seatsLine}>
                  {rowGroups[rowName]?.map((seat) => renderSeatVisual(seat, false))}
                </View>
              </View>
            ))}
          </ScrollView>
        </ScrollView>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    width: '100%',
  },
  screenBarWrapper: {
    alignItems: 'center',
    width: '100%',
  },
  screenBar: {
    width: '75%',
    height: 4,
    borderRadius: 2,
    borderTopWidth: 2,
  },
  screenLabel: {
    letterSpacing: 2,
    textAlign: 'center',
  },
  legendRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 12,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  legendChip: {
    width: 14,
    height: 14,
  },
  legendText: {
    fontSize: 11,
  },
  zoomToggleBtn: {
    borderWidth: 1,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  zoomToggleText: {},
  zoomHintText: {
    textAlign: 'center',
    paddingHorizontal: 16,
  },
  gridContentContainer: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'flex-start',
  },
  gridRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 1,
  },
  rowHeader: {
    textAlign: 'center',
    fontWeight: '600',
  },
  seatsLine: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  seatBase: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  seatNumberText: {
    fontWeight: '700',
  },
  screenReaderScroll: {
    flex: 1,
  },
  accessibleRowContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 4,
  },
  accessibleRowScroll: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
  },
});

