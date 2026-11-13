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
import { authClient, AuthSession } from './src/api/authClient';

type ScreenRoute =
  | 'welcome'
  | 'sign_in'
  | 'sign_up'
  | 'reset_password'
  | 'gallery'
  | 'movies'
  | 'movie_detail';

const MainNavigator: React.FC = () => {
  const [currentRoute, setCurrentRoute] = useState<ScreenRoute>('welcome');
  const [activeSession, setActiveSession] = useState<AuthSession | null>(null);
  const [selectedMovieId, setSelectedMovieId] = useState<number | null>(null);

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
