/**
 * A VUE UI Strings
 * Single source of truth for all user-facing text and accessibility labels.
 * Rule: All text from the strings file; less visible text on mobile.
 */

export const STRINGS = {
  appName: 'A VUE',
  tagline: 'A view. Your view. Our view.',

  common: {
    back: 'Back',
    close: 'Close',
    loading: 'Loading…',
    retry: 'Retry',
    submit: 'Submit',
    success: 'Success',
    error: 'Error',
    genericError: 'Something went wrong. Please try again.',
    or: 'or',
  },

  welcome: {
    title: 'A VUE',
    subtitle: 'A view. Your view. Our view.',
    signInAction: 'Sign in',
    signUpAction: 'Sign up',
    openGalleryAction: 'Component gallery',
    logoAccessibilityLabel: 'A VUE Logo (Asset pending)',
    signInAccessibilityHint: 'Navigates to the sign in screen',
    signUpAccessibilityHint: 'Navigates to the sign up screen',
    galleryAccessibilityHint: 'Navigates to the hidden component gallery',
  },

  signIn: {
    title: 'Welcome back',
    subtitle: 'Sign in to access your bookings and reserve seats',
    emailLabel: 'Email address',
    emailPlaceholder: 'you@example.com',
    passwordLabel: 'Password',
    passwordPlaceholder: 'Enter your password',
    forgotPassword: 'Forgot password?',
    submitButton: 'Sign in',
    submittingButton: 'Signing in…',
    noAccountPrompt: "Don't have an account?",
    signUpLink: 'Sign up',
    invalidCredentialsError: 'Invalid email or password. Please try again.',
  },

  signUp: {
    title: 'Create account',
    subtitle: 'Join A VUE for instant cinema booking',
    emailLabel: 'Email address',
    emailPlaceholder: 'you@example.com',
    passwordLabel: 'Password',
    passwordPlaceholder: 'Create a strong password',
    submitButton: 'Create account',
    submittingButton: 'Creating account…',
    haveAccountPrompt: 'Already have an account?',
    signInLink: 'Sign in',
    emailAlreadyExistsError: 'An account with this email already exists.',
  },

  checklist: {
    title: 'Password must contain:',
    minLength: '8–128 characters',
    uppercase: 'At least one uppercase letter',
    lowercase: 'At least one lowercase letter',
    digitOrSymbol: 'At least one number or symbol',
    accessibleValid: 'Satisfied',
    accessibleInvalid: 'Not satisfied',
  },

  verifyCode: {
    title: 'Verify your email',
    subtitleWithEmail: (email: string) => `Enter the 6-digit code sent to ${email}`,
    codeLabel: '6-digit verification code',
    codeCellAccessibilityLabel: (index: number, digit: string) =>
      `Digit ${index + 1}${digit ? `: ${digit}` : ': empty'}`,
    verifyButton: 'Verify & continue',
    verifyingButton: 'Verifying…',
    resendButton: 'Resend code',
    resendCooldown: (seconds: number) => `Resend code in ${seconds}s`,
    changeEmail: 'Use different email',
    wrongCodeError: (remaining: number) =>
      `Incorrect code. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`,
    maxAttemptsError: 'Maximum attempts reached. This code is invalid. Please request a new code.',
    codeExpiredError: 'Verification code expired. Please request a new one.',
    dailyCapReachedError: 'Daily code send limit reached (5 sends per day).',
  },

  resetPassword: {
    requestTitle: 'Reset password',
    requestSubtitle: "Enter your account's email and we will send a 6-digit code.",
    sendCodeButton: 'Send reset code',
    sendingCodeButton: 'Sending code…',
    confirmTitle: 'Set new password',
    confirmSubtitle: 'Enter the verification code and choose a new password.',
    newPasswordLabel: 'New password',
    newPasswordPlaceholder: 'Enter your new password',
    submitButton: 'Reset password',
    submittingButton: 'Resetting password…',
    successMessage: 'Password successfully reset. You may now sign in.',
    backToSignIn: 'Return to sign in',
  },

  validation: {
    emailRequired: 'Email is required',
    emailInvalid: 'Please enter a valid email address',
    passwordRequired: 'Password is required',
    passwordTooShort: 'Password must be at least 8 characters',
    passwordTooLong: 'Password cannot exceed 128 characters',
    passwordNeedsUpper: 'Password requires at least one uppercase letter',
    passwordNeedsLower: 'Password requires at least one lowercase letter',
    passwordNeedsDigitOrSymbol: 'Password requires at least one digit or symbol',
    codeRequired: 'Verification code is required',
    codeInvalidLength: 'Verification code must be exactly 6 digits',
  },

  movies: {
    header: 'Movies',
    emptyStateTitle: 'No Movies Scheduled',
    emptyStateMessage: 'There are currently no movies or showtimes available. Please check back soon.',
    signOutAction: 'Sign out',
    signOutAccessibilityHint: 'Signs out of your account and returns to the welcome screen',
    loadMoreAction: 'Load more',
    loadingMore: 'Loading more movies…',
    tmdbAttribution:
      'This application uses TMDB and the TMDB APIs but is not endorsed, certified, or otherwise approved by TMDB.',
    posterAccessibilityLabel: (title: string) => `Poster for ${title}`,
    cardAccessibilityLabel: (title: string, year: string, rating: number) =>
      `${title}, ${year}, rated ${rating} out of 10`,
    ratingLabel: (rating: number) => `${rating.toFixed(1)}/10`,
    noPoster: 'No poster available',
  },

  movieDetail: {
    backAction: 'Back',
    backAccessibilityLabel: 'Back to movies',
    runtime: (minutes: number) => `${minutes} min`,
    releaseDate: (date: string) => `Released ${date}`,
    genresHeader: 'Genres',
    overviewHeader: 'Overview',
    noOverview: 'No overview available for this title.',
  },

  accessibility: {
    showPassword: 'Show password',
    hidePassword: 'Hide password',
    clearText: 'Clear input',
    formErrorPrefix: 'Form error: ',
    themeToggleLight: 'Switch to light mode',
    themeToggleDark: 'Switch to dark mode',
  },

  gallery: {
    title: 'Component Gallery',
    subtitle: 'A VUE design tokens and states audit',
    buttonsSection: 'Buttons (Variants & States)',
    textFieldsSection: 'Text Fields (Variants & States)',
    passwordFieldsSection: 'Password Fields & Checklist',
    codeInputsSection: 'Code Inputs (States)',
    formErrorsSection: 'Form Errors & Alerts',
    stateDefault: 'Default',
    stateFocused: 'Focused',
    statePressed: 'Pressed',
    stateDisabled: 'Disabled',
    stateLoading: 'Loading',
    stateError: 'Error',
    primaryButton: 'Primary Button',
    secondaryButton: 'Secondary Button',
    textButton: 'Text Button',
    backToAuth: 'Back to Auth',
  },
} as const;

