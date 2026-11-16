import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { EmptyState, PhotoFade, ScreenShell, Skeleton } from '../components';
import { useTheme } from '../context/ThemeContext';
import { STRINGS } from '../constants/strings';
import { TicketItem } from '../schemas/cinema';
import { cinemaClient } from '../api/cinemaClient';

export interface MyTicketsScreenProps {
  onBack: () => void;
  onSelectTicket: (ticket: TicketItem) => void;
  onBrowseMovies: () => void;
}

export const MyTicketsScreen: React.FC<MyTicketsScreenProps> = ({
  onBack,
  onSelectTicket,
  onBrowseMovies,
}) => {
  const { colors, spacing, typography, radius } = useTheme();

  const [tickets, setTickets] = useState<TicketItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const fetchTickets = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const res = await cinemaClient.getUserTickets();
      setTickets(res.tickets);
    } catch (err: any) {
      setError(err.message || STRINGS.common.genericError);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchTickets();
  }, [fetchTickets]);

  // Sort upcoming first (startsAt > now), then past
  const sortedTickets = useMemo(() => {
    const now = Date.now();
    const upcoming: TicketItem[] = [];
    const past: TicketItem[] = [];

    for (const t of tickets) {
      if (new Date(t.startsAt).getTime() >= now && t.status !== 'cancelled') {
        upcoming.push(t);
      } else {
        past.push(t);
      }
    }

    // Sort upcoming soonest first
    upcoming.sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
    // Sort past most recent first
    past.sort((a, b) => new Date(b.startsAt).getTime() - new Date(a.startsAt).getTime());

    return [...upcoming, ...past];
  }, [tickets]);

  const formatTicketDate = (isoString: string): string => {
    const d = new Date(isoString);
    return d.toLocaleString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const renderTicketItem = ({ item }: { item: TicketItem }) => {
    const isUpcoming =
      new Date(item.startsAt).getTime() >= Date.now() && item.status === 'active';

    return (
      <Pressable
        onPress={() => onSelectTicket(item)}
        accessibilityRole="button"
        accessibilityLabel={`${item.movieTitle || 'Movie'}, ${item.cinemaName}, Row ${item.row} Seat ${item.number}, ${item.status}`}
        style={({ pressed }) => [
          styles.ticketItemCard,
          {
            backgroundColor: colors.surface_container_low,
            borderColor: isUpcoming ? colors.primary : colors.outline_variant,
            borderWidth: isUpcoming ? 1.5 : 1,
            borderRadius: radius.md,
            padding: spacing.base,
            marginBottom: spacing.base,
            opacity: pressed ? 0.85 : 1.0,
          },
        ]}
      >
        <View style={styles.cardHeader}>
          <Text
            allowFontScaling
            accessibilityRole="header"
            numberOfLines={1}
            style={[
              styles.cardTitle,
              {
                color: colors.on_surface,
                fontFamily: typography.titleMedium.fontFamily,
                fontSize: typography.titleMedium.fontSize,
                fontWeight: '700',
                flex: 1,
              },
            ]}
          >
            {item.movieTitle || 'Movie Ticket'}
          </Text>

          <View
            style={[
              styles.badge,
              {
                backgroundColor:
                  item.status === 'active'
                    ? colors.secondary_container
                    : item.status === 'used'
                      ? colors.surface_container_highest
                      : colors.error_container,
                borderRadius: radius.sm,
                paddingHorizontal: spacing.sm,
                paddingVertical: 2,
              },
            ]}
          >
            <Text
              allowFontScaling
              style={[
                styles.badgeText,
                {
                  color:
                    item.status === 'active'
                      ? colors.on_secondary_container
                      : item.status === 'used'
                        ? colors.on_surface_variant
                        : colors.on_error_container,
                  fontFamily: typography.labelSmall.fontFamily,
                  fontSize: 11,
                  fontWeight: '700',
                },
              ]}
            >
              {item.status.toUpperCase()}
            </Text>
          </View>
        </View>

        <Text
          allowFontScaling
          style={[
            styles.cinemaText,
            {
              color: colors.on_surface_variant,
              fontFamily: typography.bodyMedium.fontFamily,
              marginTop: 4,
            },
          ]}
        >
          {item.cinemaName} • {item.hallName}
        </Text>

        <View style={[styles.metaRow, { marginTop: spacing.md }]}>
          <Text
            allowFontScaling
            style={[
              styles.dateText,
              {
                color: colors.primary,
                fontFamily: typography.labelMedium.fontFamily,
                fontWeight: '600',
              },
            ]}
          >
            📅 {formatTicketDate(item.startsAt)}
          </Text>

          <Text
            allowFontScaling
            style={[
              styles.seatBadgeText,
              {
                color: colors.on_surface,
                fontFamily: typography.labelLarge.fontFamily,
                fontWeight: '700',
              },
            ]}
          >
            Row {item.row}, Seat {item.number}
          </Text>
        </View>
      </Pressable>
    );
  };

  return (
    <ScreenShell
      title={STRINGS.tickets.myTicketsHeader}
      onBack={onBack}
      scrollable={false}
      contentContainerStyle={[styles.container, { padding: 0 }]}
    >
      {loading ? (
        <View style={[styles.skeletonContainer, { padding: spacing.base }]}>
          <Skeleton height={110} borderRadius={radius.md} style={{ marginBottom: spacing.md }} />
          <Skeleton height={110} borderRadius={radius.md} style={{ marginBottom: spacing.md }} />
          <Skeleton height={110} borderRadius={radius.md} />
        </View>
      ) : error ? (
        <View style={styles.centeredContainer}>
          <EmptyState
            title={STRINGS.common.error}
            message={error}
            actionTitle={STRINGS.common.retry}
            onActionPress={() => fetchTickets(false)}
          />
        </View>
      ) : sortedTickets.length === 0 ? (
        <View style={styles.centeredContainer}>
          <PhotoFade
            source={require('../../assets/photos/my-tickets.jpg')}
            decorative
            style={[styles.emptyPhoto, { borderRadius: radius.md, marginBottom: spacing.base }]}
          />
          <EmptyState
            title={STRINGS.tickets.emptyTicketsTitle}
            message={STRINGS.tickets.emptyTicketsMessage}
            actionTitle={STRINGS.tickets.browseMoviesAction}
            onActionPress={onBrowseMovies}
          />
        </View>
      ) : (
        <FlatList
          data={sortedTickets}
          keyExtractor={(item) => item.id}
          renderItem={renderTicketItem}
          contentContainerStyle={[styles.listContent, { padding: spacing.base, paddingBottom: spacing.xxl }]}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => fetchTickets(true)}
              tintColor={colors.primary}
            />
          }
        />
      )}
    </ScreenShell>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  skeletonContainer: {
    flex: 1,
    width: '100%',
  },
  centeredContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  emptyPhoto: {
    width: '100%',
    maxWidth: 280,
    height: 160,
    alignSelf: 'center',
  },
  listContent: {
    width: '100%',
  },
  ticketItemCard: {
    width: '100%',
    minHeight: 44,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardTitle: {
    letterSpacing: -0.1,
  },
  badge: {},
  badgeText: {},
  cinemaText: {},
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  dateText: {},
  seatBadgeText: {},
});

