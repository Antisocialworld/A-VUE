import React, { useEffect, useRef, useState } from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider, useTheme } from './src/context/ThemeContext';
import { FontProvider } from './src/context/FontLoader';
import { WelcomeScreen } from './src/screens/WelcomeScreen';
import { SignInScreen } from './src/screens/SignInScreen';
import { SignUpScreen } from './src/screens/SignUpScreen';
import { ResetPasswordScreen } from './src/screens/ResetPasswordScreen';
import { ComponentGalleryScreen } from './src/screens/ComponentGalleryScreen';
import { MoviesHomeScreen } from './src/screens/MoviesHomeScreen';
import { MovieDetailScreen } from './src/screens/MovieDetailScreen';
import { ShowtimesScreen } from './src/screens/ShowtimesScreen';
import { SeatMapScreen } from './src/screens/SeatMapScreen';
import { WaitingRoomScreen } from './src/screens/WaitingRoomScreen';
import { CheckoutScreen } from './src/screens/CheckoutScreen';
import { TicketScreen } from './src/screens/TicketScreen';
import { MyTicketsScreen } from './src/screens/MyTicketsScreen';
import { Button } from './src/components';
import { STRINGS } from './src/constants/strings';
import { authClient, AuthSession, ScheduledForDeletionInfo } from './src/api/authClient';
import { cinemaClient } from './src/api/cinemaClient';
import { HoldSeatsResponse, SeatMapItem, ShowtimeItem } from './src/schemas/cinema';

type ScreenRoute =
  | 'welcome'
  | 'sign_in'
  | 'sign_up'
  | 'reset_password'
  | 'gallery'
  | 'movies'
  | 'movie_detail'
  | 'showtimes'
  | 'seat_map'
  | 'waiting_room'
  | 'checkout'
  | 'ticket'
  | 'my_tickets';

const MainNavigator: React.FC = () => {
  const [currentRoute, setCurrentRoute] = useState<ScreenRoute>('welcome');
  const [activeSession, setActiveSession] = useState<AuthSession | null>(null);
  const [selectedMovieId, setSelectedMovieId] = useState<number | null>(null);
  const [selectedMovieTitle, setSelectedMovieTitle] = useState<string>('');
  const [selectedMoviePosterUrl, setSelectedMoviePosterUrl] = useState<string | undefined>(undefined);
  const [selectedMovieReleaseYear, setSelectedMovieReleaseYear] = useState<string | undefined>(undefined);
  const [selectedMovieVoteAverage, setSelectedMovieVoteAverage] = useState<number | undefined>(undefined);
  const [selectedShowtime, setSelectedShowtime] = useState<ShowtimeItem | null>(null);
  const [selectedSeatIds, setSelectedSeatIds] = useState<string[]>([]);
  const [selectedSeats, setSelectedSeats] = useState<SeatMapItem[]>([]);
  const selectedSeatIdsRef = useRef<string[]>([]);
  const selectedSeatsRef = useRef<SeatMapItem[]>([]);
  const [holdResponse, setHoldResponse] = useState<HoldSeatsResponse | null>(null);
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);

  const handleSignInSuccess = (session: AuthSession) => {
    setActiveSession(session);
    setCurrentRoute('movies');
  };

  const handleSignUpSuccess = (session: AuthSession) => {
    setActiveSession(session);
    setCurrentRoute('movies');
  };

  const handleSignOut = async () => {
    try {
      await authClient.signOut();
    } catch {
      // Ignore cleanup error
    } finally {
      setActiveSession(null);
      setCurrentRoute('welcome');
    }
  };

  const { colors, spacing, radius, typography, shadows } = useTheme();
  const [scheduledDeletionInfo, setScheduledDeletionInfo] = useState<ScheduledForDeletionInfo | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = authClient.onScheduledForDeletion((info) => {
      setScheduledDeletionInfo(info);
      setRestoreError(null);
    });
    return unsubscribe;
  }, []);

  const handleRestoreAccount = async () => {
    if (!scheduledDeletionInfo || !scheduledDeletionInfo.password) return;
    setRestoring(true);
    setRestoreError(null);
    try {
      const session = await authClient.restoreAccount(
        scheduledDeletionInfo.email,
        scheduledDeletionInfo.password,
      );
      setScheduledDeletionInfo(null);
      setActiveSession(session);
      setCurrentRoute('movies');
    } catch (err: any) {
      setRestoreError(err?.message || STRINGS.common.genericError);
    } finally {
      setRestoring(false);
    }
  };

  const renderScreen = () => {
    if (currentRoute === 'gallery') {
      return <ComponentGalleryScreen onBack={() => setCurrentRoute(activeSession ? 'movies' : 'welcome')} />;
    }

  if (currentRoute === 'sign_in') {
    return (
      <SignInScreen
        onBack={() => setCurrentRoute('welcome')}
        onNavigateToSignUp={() => setCurrentRoute('sign_up')}
        onNavigateToResetPassword={() => setCurrentRoute('reset_password')}
        onSignInSuccess={handleSignInSuccess}
      />
    );
  }

  if (currentRoute === 'sign_up') {
    return (
      <SignUpScreen
        onBack={() => setCurrentRoute('welcome')}
        onNavigateToSignIn={() => setCurrentRoute('sign_in')}
        onSignUpSuccess={handleSignUpSuccess}
      />
    );
  }

  if (currentRoute === 'reset_password') {
    return (
      <ResetPasswordScreen
        onBack={() => setCurrentRoute('sign_in')}
        onNavigateToSignIn={() => setCurrentRoute('sign_in')}
      />
    );
  }

  if (currentRoute === 'movies' && activeSession) {
    return (
      <MoviesHomeScreen
        onSignOut={handleSignOut}
        onSelectMovie={(movieOrId, movieTitle, posterUrl, releaseYear, voteAverage) => {
          if (typeof movieOrId === 'object' && movieOrId !== null) {
            setSelectedMovieId(movieOrId.movieId);
            setSelectedMovieTitle(movieOrId.movieTitle || '');
            setSelectedMoviePosterUrl(movieOrId.posterUrl);
            setSelectedMovieReleaseYear(movieOrId.releaseYear);
            setSelectedMovieVoteAverage(movieOrId.voteAverage);
          } else {
            setSelectedMovieId(movieOrId);
            if (movieTitle) setSelectedMovieTitle(movieTitle);
            setSelectedMoviePosterUrl(posterUrl);
            setSelectedMovieReleaseYear(releaseYear);
            setSelectedMovieVoteAverage(voteAverage);
          }
          setCurrentRoute('movie_detail');
        }}
        onNavigateToTickets={() => setCurrentRoute('my_tickets')}
      />
    );
  }

  if (currentRoute === 'movie_detail' && selectedMovieId !== null) {
    return (
      <MovieDetailScreen
        movieId={selectedMovieId}
        onBack={() => {
          setSelectedMovieId(null);
          setSelectedMovieTitle('');
          setSelectedMoviePosterUrl(undefined);
          setSelectedMovieReleaseYear(undefined);
          setSelectedMovieVoteAverage(undefined);
          setCurrentRoute('movies');
        }}
        onGetTickets={(id, title) => {
          setSelectedMovieId(id);
          setSelectedMovieTitle(title);
          setCurrentRoute('showtimes');
        }}
      />
    );
  }

  if (currentRoute === 'showtimes' && selectedMovieId !== null) {
    return (
      <ShowtimesScreen
        movieId={selectedMovieId}
        movieTitle={selectedMovieTitle || 'Showtimes'}
        posterUrl={selectedMoviePosterUrl}
        releaseYear={selectedMovieReleaseYear}
        voteAverage={selectedMovieVoteAverage}
        onBack={() => setCurrentRoute('movie_detail')}
        onSelectShowtime={(st) => {
          setSelectedShowtime(st);
          setCurrentRoute('seat_map');
        }}
      />
    );
  }

  if (currentRoute === 'seat_map' && selectedShowtime !== null) {
    return (
      <SeatMapScreen
        showtime={selectedShowtime}
        movieTitle={selectedMovieTitle || 'Select Seats'}
        onBack={() => setCurrentRoute('showtimes')}
        onProceedToCheckout={(params) => {
          selectedSeatIdsRef.current = params.selectedSeatIds;
          selectedSeatsRef.current = params.selectedSeats;
          setSelectedSeatIds(params.selectedSeatIds);
          setSelectedSeats(params.selectedSeats);
          setHoldResponse(params.holdResponse);
          setCurrentRoute('checkout');
        }}
        onOpenWaitingRoom={(seatIds, seats) => {
          selectedSeatIdsRef.current = seatIds;
          setSelectedSeatIds(seatIds);
          if (seats && seats.length > 0) {
            selectedSeatsRef.current = seats;
            setSelectedSeats(seats);
          }
          setCurrentRoute('waiting_room');
        }}
      />
    );
  }

  if (currentRoute === 'waiting_room' && selectedShowtime !== null) {
    return (
      <WaitingRoomScreen
        showtimeId={selectedShowtime.id}
        onBack={() => setCurrentRoute('seat_map')}
        onAdmitted={async (pass) => {
          try {
            const seatIdsToHold = selectedSeatIdsRef.current.length > 0
              ? selectedSeatIdsRef.current
              : selectedSeatIds;
            const holdRes = await cinemaClient.holdSeats(selectedShowtime.id, seatIdsToHold, pass);
            setHoldResponse(holdRes);
            if (selectedSeatsRef.current.length > 0) {
              setSelectedSeats(selectedSeatsRef.current);
            }
            setSelectedSeatIds(seatIdsToHold);
            setCurrentRoute('checkout');
          } catch {
            setCurrentRoute('seat_map');
          }
        }}
      />
    );
  }

  if (currentRoute === 'checkout' && selectedShowtime !== null && holdResponse !== null) {
    const activeSeats = selectedSeatsRef.current.length > 0 ? selectedSeatsRef.current : selectedSeats;
    const activeSeatIds = selectedSeatIdsRef.current.length > 0 ? selectedSeatIdsRef.current : selectedSeatIds;
    return (
      <CheckoutScreen
        showtime={selectedShowtime}
        selectedSeatIds={activeSeatIds}
        selectedSeats={activeSeats}
        holdResponse={holdResponse}
        movieTitle={selectedMovieTitle || 'Checkout'}
        onBack={() => setCurrentRoute('seat_map')}
        onPaymentSuccess={(ticketId) => {
          setSelectedTicketId(ticketId);
          setCurrentRoute('ticket');
        }}
        onGoToMyTickets={() => setCurrentRoute('my_tickets')}
      />
    );
  }

  if (currentRoute === 'ticket' && selectedTicketId !== null) {
    return (
      <TicketScreen
        ticketId={selectedTicketId}
        onBack={() => setCurrentRoute('my_tickets')}
      />
    );
  }

  if (currentRoute === 'my_tickets') {
    return (
      <MyTicketsScreen
        onBack={() => setCurrentRoute('movies')}
        onSelectTicket={(ticket) => {
          setSelectedTicketId(ticket.id);
          setCurrentRoute('ticket');
        }}
        onBrowseMovies={() => setCurrentRoute('movies')}
      />
    );
  }

    return (
      <WelcomeScreen
        onNavigateToSignIn={() => setCurrentRoute('sign_in')}
        onNavigateToSignUp={() => setCurrentRoute('sign_up')}
        onNavigateToGallery={() => setCurrentRoute('gallery')}
      />
    );
  };

  return (
    <>
      {renderScreen()}

      {/* Account Deletion Restore Prompt Modal */}
      {scheduledDeletionInfo && (
        <Modal
          visible={true}
          transparent={true}
          animationType="fade"
          onRequestClose={() => setScheduledDeletionInfo(null)}
        >
          <View style={[styles.modalBackdrop, { backgroundColor: colors.scrim + '99' }]}>
            <View
              style={[
                styles.dialogCard,
                shadows.medium,
                {
                  backgroundColor: colors.surface_container,
                  borderRadius: radius.lg,
                  padding: spacing.lg,
                  borderColor: colors.outline_variant,
                },
              ]}
            >
              <Text
                style={[
                  typography.titleMedium,
                  { color: colors.on_surface, marginBottom: spacing.sm, fontWeight: '700' },
                ]}
                accessibilityRole="header"
              >
                {STRINGS.account.restorePromptTitle}
              </Text>
              <Text
                style={[
                  typography.bodyMedium,
                  { color: colors.on_surface_variant, marginBottom: spacing.lg },
                ]}
              >
                {STRINGS.account.restorePromptMessage(
                  scheduledDeletionInfo.purgeAfter
                    ? new Date(scheduledDeletionInfo.purgeAfter).toLocaleDateString()
                    : 'the scheduled date',
                )}
              </Text>

              {restoreError ? (
                <Text
                  style={[
                    typography.bodySmall,
                    { color: colors.error, marginBottom: spacing.md, fontWeight: '600' },
                  ]}
                  accessibilityRole="alert"
                >
                  {restoreError}
                </Text>
              ) : null}

              <View style={styles.dialogButtonRow}>
                <View style={styles.buttonHalf}>
                  <Button
                    title={STRINGS.account.cancelRestoreAction}
                    onPress={() => setScheduledDeletionInfo(null)}
                    variant="outlined"
                    disabled={restoring}
                    accessibilityLabel={STRINGS.account.cancelRestoreAction}
                  />
                </View>
                <View style={styles.buttonHalf}>
                  <Button
                    title={STRINGS.account.restoreAction}
                    onPress={handleRestoreAccount}
                    variant="primary"
                    loading={restoring}
                    disabled={restoring}
                    accessibilityLabel={STRINGS.account.restoreAction}
                  />
                </View>
              </View>
            </View>
          </View>
        </Modal>
      )}
    </>
  );
};

const styles = StyleSheet.create({
  modalBackdrop: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  dialogCard: {
    width: '100%',
    maxWidth: 380,
    borderWidth: 1,
  },
  dialogButtonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  buttonHalf: {
    flex: 1,
  },
});

export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <FontProvider>
          <MainNavigator />
        </FontProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
