import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Button, EmptyState, ScreenShell, Skeleton } from '../components';
import { useTheme } from '../context/ThemeContext';
import { STRINGS } from '../constants/strings';
import { ShowtimeItem } from '../schemas/cinema';
import { cinemaClient } from '../api/cinemaClient';
import { formatKoboToNaira } from '../utils/money';

export interface ShowtimesScreenProps {
  movieId: number | string;
  movieTitle: string;
  onBack: () => void;
  onSelectShowtime: (showtime: ShowtimeItem) => void;
}

interface DateOption {
  dateStr: string; // YYYY-MM-DD
  dayLabel: string; // "Today", "Tomorrow", "Mon"
  dateNum: number; // 14, 15...
}

export const ShowtimesScreen: React.FC<ShowtimesScreenProps> = ({
  movieId,
  movieTitle,
  onBack,
  onSelectShowtime,
}) => {
  const { colors, spacing, typography, radius } = useTheme();

  const [showtimes, setShowtimes] = useState<ShowtimeItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // 7-day date strip options
  const dateOptions: DateOption[] = useMemo(() => {
    const list: DateOption[] = [];
    const today = new Date();

    for (let i = 0; i < 7; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() + i);

      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      const dateStr = `${yyyy}-${mm}-${dd}`;

      let dayLabel = d.toLocaleDateString('en-US', { weekday: 'short' });
      if (i === 0) dayLabel = STRINGS.showtimes.dateToday;
      if (i === 1) dayLabel = STRINGS.showtimes.dateTomorrow;

      list.push({
        dateStr,
        dayLabel,
        dateNum: d.getDate(),
      });
    }
    return list;
  }, []);

  const [selectedDateStr, setSelectedDateStr] = useState<string>(
    dateOptions[0]?.dateStr || ''
  );

  const fetchShowtimes = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const data = await cinemaClient.getMovieShowtimes(movieId);
      setShowtimes(data.showtimes);
    } catch (err: any) {
      setError(err.message || STRINGS.common.genericError);
    } finally {
      setLoading(false);
    }
  }, [movieId]);

  useEffect(() => {
    fetchShowtimes();
  }, [fetchShowtimes]);

  // Filter showtimes for the selected date
  const filteredShowtimes = useMemo(() => {
    return showtimes.filter((st) => {
      const stDate = st.startsAt.split('T')[0];
      return stDate === selectedDateStr;
    });
  }, [showtimes, selectedDateStr]);

  // Group filtered showtimes by cinema
  const cinemaGroups = useMemo(() => {
    const groups: Record<string, { cinemaName: string; city: string; items: ShowtimeItem[] }> = {};

    for (const item of filteredShowtimes) {
      if (!groups[item.cinemaId]) {
        groups[item.cinemaId] = {
          cinemaName: item.cinemaName,
          city: item.city,
          items: [],
        };
      }
      groups[item.cinemaId].items.push(item);
    }

    // Sort items within each cinema by start time
    for (const id of Object.keys(groups)) {
      groups[id].items.sort(
        (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()
      );
    }

    return Object.values(groups);
  }, [filteredShowtimes]);

  const formatShowtimeHours = (isoString: string): string => {
    const d = new Date(isoString);
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
  };

  return (
    <ScreenShell
      title={STRINGS.showtimes.header}
      onBack={onBack}
      scrollable={false}
      contentContainerStyle={[styles.container, { padding: 0 }]}
    >
      {/* Movie Mini Header */}
      <View
        style={[
          styles.miniHeader,
          {
            backgroundColor: colors.surface_container_low,
            borderBottomColor: colors.outline_variant,
            paddingHorizontal: spacing.base,
            paddingVertical: spacing.md,
          },
        ]}
      >
        <Text
          allowFontScaling
          numberOfLines={1}
          style={[
            styles.movieTitleText,
            {
              color: colors.on_surface,
              fontFamily: typography.titleMedium.fontFamily,
              fontSize: typography.titleMedium.fontSize,
              fontWeight: typography.titleMedium.fontWeight,
            },
          ]}
        >
          {movieTitle}
        </Text>
      </View>

      {/* 7-Day Date Strip */}
      <View
        style={[
          styles.dateStripWrapper,
          {
            backgroundColor: colors.surface_container_lowest,
            borderBottomColor: colors.outline_variant,
          },
        ]}
      >
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={[styles.dateStripContent, { paddingHorizontal: spacing.sm }]}
        >
          {dateOptions.map((opt) => {
            const isSelected = opt.dateStr === selectedDateStr;
            return (
              <Pressable
                key={opt.dateStr}
                onPress={() => setSelectedDateStr(opt.dateStr)}
                accessibilityRole="tab"
                accessibilityLabel={`${opt.dayLabel}, ${opt.dateNum}`}
                accessibilityState={{ selected: isSelected }}
                style={[
                  styles.datePill,
                  {
                    backgroundColor: isSelected ? colors.primary : colors.surface_container_low,
                    borderColor: isSelected ? colors.primary : colors.outline_variant,
                    borderRadius: radius.md,
                    paddingHorizontal: spacing.md,
                    paddingVertical: spacing.sm,
                    marginHorizontal: spacing.xs,
                  },
                ]}
              >
                <Text
                  allowFontScaling
                  style={[
                    styles.dateDayText,
                    {
                      color: isSelected ? colors.on_primary : colors.on_surface_variant,
                      fontFamily: typography.labelSmall.fontFamily,
                      fontSize: typography.labelSmall.fontSize,
                    },
                  ]}
                >
                  {opt.dayLabel}
                </Text>
                <Text
                  allowFontScaling
                  style={[
                    styles.dateNumText,
                    {
                      color: isSelected ? colors.on_primary : colors.on_surface,
                      fontFamily: typography.titleMedium.fontFamily,
                      fontSize: typography.titleMedium.fontSize,
                      fontWeight: '700',
                    },
                  ]}
                >
                  {opt.dateNum}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {/* Main Content Area */}
      {loading ? (
        <View style={[styles.skeletonContainer, { padding: spacing.base }]}>
          <Skeleton height={28} width="50%" borderRadius={radius.sm} style={{ marginBottom: spacing.md }} />
          <View style={{ flexDirection: 'row', gap: spacing.md, marginBottom: spacing.xl }}>
            <Skeleton height={70} width={90} borderRadius={radius.md} />
            <Skeleton height={70} width={90} borderRadius={radius.md} />
            <Skeleton height={70} width={90} borderRadius={radius.md} />
          </View>
          <Skeleton height={28} width="60%" borderRadius={radius.sm} style={{ marginBottom: spacing.md }} />
          <View style={{ flexDirection: 'row', gap: spacing.md }}>
            <Skeleton height={70} width={90} borderRadius={radius.md} />
            <Skeleton height={70} width={90} borderRadius={radius.md} />
          </View>
        </View>
      ) : error ? (
        <View style={[styles.centeredState, { padding: spacing.xl }]}>
          <EmptyState
            title={STRINGS.common.error}
            message={error}
            actionTitle={STRINGS.common.retry}
            onActionPress={fetchShowtimes}
          />
        </View>
      ) : cinemaGroups.length === 0 ? (
        <View style={[styles.centeredState, { padding: spacing.xl }]}>
          <EmptyState
            title={STRINGS.showtimes.noShowtimesDayTitle}
            message={STRINGS.showtimes.noShowtimesDayMessage}
          />
        </View>
      ) : (
        <ScrollView contentContainerStyle={[styles.scrollContent, { padding: spacing.base, paddingBottom: spacing.xxl }]}>
          {cinemaGroups.map((group) => (
            <View
              key={group.cinemaName}
              style={[
                styles.cinemaCard,
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
                  styles.cinemaName,
                  {
                    color: colors.on_surface,
                    fontFamily: typography.titleMedium.fontFamily,
                    fontSize: typography.titleMedium.fontSize,
                    fontWeight: typography.titleMedium.fontWeight,
                  },
                ]}
              >
                {group.cinemaName}
              </Text>
              <Text
                allowFontScaling
                style={[
                  styles.cinemaCity,
                  {
                    color: colors.on_surface_variant,
                    fontFamily: typography.bodySmall.fontFamily,
                    fontSize: typography.bodySmall.fontSize,
                    marginTop: 2,
                    marginBottom: spacing.md,
                  },
                ]}
              >
                {group.city}
              </Text>

              {/* Time Tiles Grid */}
              <View style={styles.tilesGrid}>
                {group.items.map((st) => {
                  const isSoldOut = st.isCancelled;
                  const priceText = formatKoboToNaira(st.priceKobo);
                  const timeStr = formatShowtimeHours(st.startsAt);

                  return (
                    <Pressable
                      key={st.id}
                      onPress={() => onSelectShowtime(st)}
                      disabled={isSoldOut}
                      accessibilityRole="button"
                      accessibilityLabel={`${timeStr}, ${st.hallName}, ${priceText}${isSoldOut ? ', sold out' : ''}`}
                      accessibilityState={{ disabled: isSoldOut }}
                      style={({ pressed }) => [
                        styles.timeTile,
                        {
                          backgroundColor: isSoldOut
                            ? colors.surface_container_highest
                            : pressed
                            ? colors.surface_container_high
                            : colors.surface_container,
                          borderColor: colors.outline_variant,
                          borderRadius: radius.sm,
                          padding: spacing.sm,
                          opacity: isSoldOut ? 0.5 : 1,
                        },
                      ]}
                    >
                      <Text
                        allowFontScaling
                        style={[
                          styles.timeText,
                          {
                            color: colors.on_surface,
                            fontFamily: typography.titleMedium.fontFamily,
                            fontSize: typography.titleMedium.fontSize,
                            fontWeight: '700',
                          },
                        ]}
                      >
                        {timeStr}
                      </Text>
                      <Text
                        allowFontScaling
                        style={[
                          styles.hallText,
                          {
                            color: colors.on_surface_variant,
                            fontFamily: typography.labelSmall.fontFamily,
                            fontSize: 10,
                            marginTop: 2,
                          },
                        ]}
                      >
                        {st.hallName}
                      </Text>
                      <Text
                        allowFontScaling
                        style={[
                          styles.priceText,
                          {
                            color: colors.primary,
                            fontFamily: typography.labelSmall.fontFamily,
                            fontSize: typography.labelSmall.fontSize,
                            fontWeight: '600',
                            marginTop: 4,
                          },
                        ]}
                      >
                        {isSoldOut ? STRINGS.showtimes.soldOut : priceText}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ))}
        </ScrollView>
      )}
    </ScreenShell>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  miniHeader: {
    width: '100%',
    borderBottomWidth: 1,
  },
  movieTitleText: {
    letterSpacing: -0.1,
  },
  dateStripWrapper: {
    width: '100%',
    borderBottomWidth: 1,
    paddingVertical: 8,
  },
  dateStripContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  datePill: {
    minWidth: 54,
    minHeight: 54,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  dateDayText: {
    fontWeight: '500',
  },
  dateNumText: {
    marginTop: 2,
  },
  skeletonContainer: {
    flex: 1,
    width: '100%',
  },
  centeredState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollContent: {
    width: '100%',
  },
  cinemaCard: {
    width: '100%',
    borderWidth: 1,
  },
  cinemaName: {
    letterSpacing: -0.1,
  },
  cinemaCity: {},
  tilesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  timeTile: {
    minWidth: 84,
    minHeight: 64,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  timeText: {},
  hallText: {},
  priceText: {},
});

