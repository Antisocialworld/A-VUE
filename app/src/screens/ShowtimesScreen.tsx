import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Svg, { Defs, G, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { Button, EmptyState, ScreenShell, Skeleton } from '../components';
import { useTheme } from '../context/ThemeContext';
import { STRINGS } from '../constants/strings';
import { ShowtimeItem } from '../schemas/cinema';
import { cinemaClient } from '../api/cinemaClient';
import { formatKoboToNaira } from '../utils/money';
import { WORDMARK_BOX, WORDMARK_PATHS } from '../components/Wordmark';
import colorData from '../tokens/color-tokens-orange-green-yellow.json';

const CINEMA_CARD_PHOTOS = [
  require('../../assets/photos/cinema-card-1.jpg'),
  require('../../assets/photos/cinema-card-2.jpg'),
  require('../../assets/photos/cinema-card-3.jpg'),
  require('../../assets/photos/cinema-card-4.jpg'),
];

export interface ShowtimesScreenProps {
  movieId: number | string;
  movieTitle: string;
  onBack: () => void;
  onSelectShowtime: (showtime: ShowtimeItem) => void;
  posterUrl?: string;
  releaseYear?: string;
  voteAverage?: number;
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
  posterUrl,
  releaseYear,
  voteAverage,
}) => {
  const { colors, spacing, typography, radius } = useTheme();

  const [imageError, setImageError] = useState<boolean>(false);
  const [showtimes, setShowtimes] = useState<ShowtimeItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const hasPoster = Boolean(posterUrl && !imageError);
  const hasMeta = Boolean(releaseYear || typeof voteAverage === 'number');

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

  // Sorted unique cinema IDs for deterministic image assignment (Rule: modulo 4 on sorted index)
  const sortedCinemaIds = useMemo(() => {
    const ids = Array.from(new Set(showtimes.map((s) => s.cinemaId)));
    return ids.sort((a, b) => a.localeCompare(b));
  }, [showtimes]);

  // Group filtered showtimes by cinema
  const cinemaGroups = useMemo(() => {
    const groups: Record<string, { cinemaId: string; cinemaName: string; city: string; items: ShowtimeItem[] }> = {};

    for (const item of filteredShowtimes) {
      if (!groups[item.cinemaId]) {
        groups[item.cinemaId] = {
          cinemaId: item.cinemaId,
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
      {/* Movie Header Container */}
      <View
        style={[
          styles.movieHeaderContainer,
          {
            backgroundColor: colors.surface_container_low,
            borderRadius: radius.md,
            padding: spacing.sm,
            marginHorizontal: spacing.base,
            marginVertical: spacing.sm,
          },
        ]}
      >
        {hasPoster ? (
          <>
            <Image
              source={{ uri: posterUrl }}
              accessibilityRole="image"
              accessibilityLabel={STRINGS.showtimes.posterAccessibilityLabel(movieTitle)}
              onError={() => setImageError(true)}
              style={[
                styles.headerPoster,
                {
                  borderRadius: radius.sm,
                },
              ]}
            />
            <View style={[styles.headerTextContainer, { marginLeft: spacing.md }]}>
              <Text
                allowFontScaling
                numberOfLines={2}
                ellipsizeMode="tail"
                style={[
                  styles.movieTitleText,
                  {
                    color: colors.on_surface,
                    fontFamily: typography.titleMedium.fontFamily,
                    fontSize: typography.titleMedium.fontSize,
                    fontWeight: typography.titleMedium.fontWeight,
                    lineHeight: typography.titleMedium.lineHeight,
                  },
                ]}
              >
                {movieTitle}
              </Text>
              {hasMeta && (
                <View style={[styles.metaRow, { marginTop: spacing.xs, gap: spacing.sm }]}>
                  {releaseYear && (
                    <Text
                      allowFontScaling
                      style={[
                        styles.yearText,
                        {
                          color: colors.on_surface_variant,
                          fontFamily: typography.bodySmall.fontFamily,
                          fontSize: typography.bodySmall.fontSize,
                          lineHeight: typography.bodySmall.lineHeight,
                        },
                      ]}
                    >
                      {releaseYear}
                    </Text>
                  )}
                  {typeof voteAverage === 'number' && (
                    <Text
                      allowFontScaling
                      style={[
                        styles.ratingText,
                        {
                          color: colors.primary,
                          fontFamily: typography.labelSmall.fontFamily,
                          fontSize: typography.labelSmall.fontSize,
                          fontWeight: '700',
                          lineHeight: typography.labelSmall.lineHeight,
                        },
                      ]}
                    >
                      ★ {voteAverage.toFixed(1)}
                    </Text>
                  )}
                </View>
              )}
            </View>
          </>
        ) : (
          <View style={styles.headerTextContainer}>
            <Text
              allowFontScaling
              numberOfLines={2}
              ellipsizeMode="tail"
              style={[
                styles.movieTitleText,
                {
                  color: colors.on_surface,
                  fontFamily: typography.titleMedium.fontFamily,
                  fontSize: typography.titleMedium.fontSize,
                  fontWeight: typography.titleMedium.fontWeight,
                  lineHeight: typography.titleMedium.lineHeight,
                },
              ]}
            >
              {movieTitle}
            </Text>
            {hasMeta && (
              <View style={[styles.metaRow, { marginTop: spacing.xs, gap: spacing.sm }]}>
                {releaseYear && (
                  <Text
                    allowFontScaling
                    style={[
                      styles.yearText,
                      {
                        color: colors.on_surface_variant,
                        fontFamily: typography.bodySmall.fontFamily,
                        fontSize: typography.bodySmall.fontSize,
                        lineHeight: typography.bodySmall.lineHeight,
                      },
                    ]}
                  >
                    {releaseYear}
                  </Text>
                )}
                {typeof voteAverage === 'number' && (
                  <Text
                    allowFontScaling
                    style={[
                      styles.ratingText,
                      {
                        color: colors.primary,
                        fontFamily: typography.labelSmall.fontFamily,
                        fontSize: typography.labelSmall.fontSize,
                        fontWeight: '700',
                        lineHeight: typography.labelSmall.lineHeight,
                      },
                    ]}
                  >
                    ★ {voteAverage.toFixed(1)}
                  </Text>
                )}
              </View>
            )}
          </View>
        )}
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
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={[styles.scrollContent, { flexGrow: 1, paddingBottom: 0 }]}
        >
          <View style={{ padding: spacing.base }}>
            {cinemaGroups.map((group) => {
              const cinemaIndex = sortedCinemaIds.indexOf(group.cinemaId);
              const photoIndex = (cinemaIndex >= 0 ? cinemaIndex : 0) % 4;
              const cardPhoto = CINEMA_CARD_PHOTOS[photoIndex];

              return (
                <View
                  key={group.cinemaId || group.cinemaName}
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
                  {/* Decorative picture on the RIGHT behind text, feathered on all edges */}
                  <View
                    pointerEvents="none"
                    style={[
                      styles.cardPhotoContainer,
                      {
                        borderRadius: radius.sm,
                      },
                    ]}
                  >
                    <Image
                      source={cardPhoto}
                      pointerEvents="none"
                      accessibilityRole="image"
                      accessibilityLabel={STRINGS.showtimes.cinemaCardPhotoAccessibilityLabel}
                      style={styles.cardPhotoImage}
                    />
                    <Svg
                      style={StyleSheet.absoluteFill}
                      width="100%"
                      height="100%"
                      pointerEvents="none"
                    >
                      <Defs>
                        <LinearGradient id={`cardFadeH_${group.cinemaId}`} x1="0" y1="0" x2="1" y2="0">
                          <Stop offset="0" stopColor={colors.surface_container_low} stopOpacity="1" />
                          <Stop offset="0.6" stopColor={colors.surface_container_low} stopOpacity="0" />
                          <Stop offset="0.9" stopColor={colors.surface_container_low} stopOpacity="0" />
                          <Stop offset="1" stopColor={colors.surface_container_low} stopOpacity="0.8" />
                        </LinearGradient>
                        <LinearGradient id={`cardFadeV_${group.cinemaId}`} x1="0" y1="0" x2="0" y2="1">
                          <Stop offset="0" stopColor={colors.surface_container_low} stopOpacity="0.8" />
                          <Stop offset="0.2" stopColor={colors.surface_container_low} stopOpacity="0" />
                          <Stop offset="0.8" stopColor={colors.surface_container_low} stopOpacity="0" />
                          <Stop offset="1" stopColor={colors.surface_container_low} stopOpacity="0.8" />
                        </LinearGradient>
                      </Defs>
                      <Rect width="100%" height="100%" fill={`url(#cardFadeH_${group.cinemaId})`} />
                      <Rect width="100%" height="100%" fill={`url(#cardFadeV_${group.cinemaId})`} />
                    </Svg>
                  </View>
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
            );
          })}
          </View>

          {/* Footer Photo after last cinema card with top fade, dim overlay, and lettering watermark */}
          <View style={styles.footerPhotoContainer}>
            <Image
              source={require('../../assets/photos/showtimes.jpg')}
              accessibilityRole="image"
              accessibilityLabel={STRINGS.showtimes.footerPhotoAccessibilityLabel}
              style={styles.footerPhoto}
            />
            {/* Top edge fade into background token colour */}
            <Svg
              style={StyleSheet.absoluteFill}
              width="100%"
              height="100%"
              pointerEvents="none"
            >
              <Defs>
                <LinearGradient id="showtimesTopFade" x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0" stopColor={colors.surface} stopOpacity="1" />
                  <Stop offset="0.5" stopColor={colors.surface} stopOpacity="0.4" />
                  <Stop offset="1" stopColor={colors.surface} stopOpacity="0" />
                </LinearGradient>
              </Defs>
              <Rect width="100%" height="100%" fill="url(#showtimesTopFade)" />
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
            {/* A VUE Lettering Watermark drawn in code */}
            <View
              accessible={false}
              accessibilityElementsHidden={true}
              importantForAccessibility="no-hide-descendants"
              pointerEvents="none"
              style={styles.watermarkCenter}
            >
              <Svg
                width={120}
                height={120 / (WORDMARK_BOX.w / WORDMARK_BOX.h)}
                viewBox={`0 0 ${WORDMARK_BOX.w} ${WORDMARK_BOX.h}`}
                fill="none"
                accessible={false}
                style={{ opacity: 0.2 }}
              >
                <G fill={colorData.palettes.primary['80']}>
                  {WORDMARK_PATHS.map((item) => (
                    <Path key={item.id} d={item.d} fill={colorData.palettes.primary['80']} />
                  ))}
                </G>
              </Svg>
            </View>
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
  movieHeaderContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'hidden',
  },
  headerPoster: {
    width: 56,
    aspectRatio: 2 / 3,
  },
  headerTextContainer: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
  },
  movieTitleText: {
    textAlign: 'left',
    letterSpacing: -0.1,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  yearText: {},
  ratingText: {},
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
    position: 'relative',
    overflow: 'hidden',
  },
  cardPhotoContainer: {
    position: 'absolute',
    right: 8,
    top: '5%',
    width: '40%',
    height: '90%',
    overflow: 'hidden',
  },
  cardPhotoImage: {
    width: '100%',
    height: '100%',
    opacity: 0.6,
    resizeMode: 'cover',
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
  scrollView: {
    flex: 1,
    width: '100%',
  },
  footerPhotoContainer: {
    width: '100%',
    aspectRatio: 1400 / 764,
    marginTop: 'auto',
    position: 'relative',
    overflow: 'hidden',
  },
  footerPhoto: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  watermarkCenter: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

