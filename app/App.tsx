import React, { useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider } from './src/context/ThemeContext';
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
import { authClient, AuthSession } from './src/api/authClient';
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
  const [selectedShowtime, setSelectedShowtime] = useState<ShowtimeItem | null>(null);
  const [selectedSeatIds, setSelectedSeatIds] = useState<string[]>([]);
  const [selectedSeats, setSelectedSeats] = useState<SeatMapItem[]>([]);
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
        onSelectMovie={(id) => {
          setSelectedMovieId(id);
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
          setSelectedSeatIds(params.selectedSeatIds);
          setSelectedSeats(params.selectedSeats);
          setHoldResponse(params.holdResponse);
          setCurrentRoute('checkout');
        }}
        onOpenWaitingRoom={(seatIds) => {
          setSelectedSeatIds(seatIds);
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
            const holdRes = await cinemaClient.holdSeats(selectedShowtime.id, selectedSeatIds, pass);
            setHoldResponse(holdRes);
            setCurrentRoute('checkout');
          } catch {
            setCurrentRoute('seat_map');
          }
        }}
      />
    );
  }

  if (currentRoute === 'checkout' && selectedShowtime !== null && holdResponse !== null) {
    return (
      <CheckoutScreen
        showtime={selectedShowtime}
        selectedSeatIds={selectedSeatIds}
        selectedSeats={selectedSeats}
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
