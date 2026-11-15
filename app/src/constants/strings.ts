/**
 * A VUE UI Strings
 * Single source of truth for all user-facing text and accessibility labels.
 * Rule: All text from the strings file; less visible text on mobile.
 */

export const ACCOUNT_DELETION_GRACE_DAYS = 30;

export const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

export function formatDeletableDate(isoDateString?: string | null): string {
  if (!isoDateString) return 'the scheduled date';
  const isoMatch = isoDateString.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    const year = isoMatch[1];
    const monthNum = parseInt(isoMatch[2], 10);
    const day = parseInt(isoMatch[3], 10);
    const monthName = MONTH_NAMES[monthNum - 1];
    if (monthName && !isNaN(day)) {
      return `${day} ${monthName} ${year}`;
    }
  }
  const date = new Date(isoDateString);
  if (!isNaN(date.getTime())) {
    const day = date.getUTCDate();
    const monthName = MONTH_NAMES[date.getUTCMonth()];
    const year = date.getUTCFullYear();
    if (monthName) {
      return `${day} ${monthName} ${year}`;
    }
  }
  return isoDateString;
}

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
    continue: 'Continue',
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
    tba: 'TBA',
  },

  movieDetail: {
    backAction: 'Back',
    backAccessibilityLabel: 'Back to movies',
    getTicketsAction: 'Get tickets',
    runtime: (minutes: number) => `${minutes} min`,
    releaseDate: (date: string) => `Released ${date}`,
    genresHeader: 'Genres',
    overviewHeader: 'Overview',
    noOverview: 'No overview available for this title.',
  },

  showtimes: {
    header: 'Showtimes',
    posterAccessibilityLabel: (title: string) => `Poster for ${title}`,
    dateToday: 'Today',
    dateTomorrow: 'Tomorrow',
    noShowtimesDayTitle: 'No Showtimes Available',
    noShowtimesDayMessage: 'There are no showtimes scheduled for this date. Please select another date.',
    soldOut: 'Sold out',
    fewLeft: 'Few left',
    seatsLeft: (count: number) => `${count} left`,
    selectSeatsAction: 'Select seats',
    footerPhotoAccessibilityLabel: 'Cinema auditorium showing screen and seating',
    cinemaCardPhotoAccessibilityLabel: 'Cinema marquee decorative photo',
  },

  seatMap: {
    title: 'Select Seats',
    photoAccessibilityLabel: 'Auditorium seats view',
    screenIndicator: 'SCREEN',
    availableLegend: 'Available',
    selectedLegend: 'Selected',
    heldLegend: 'Held',
    soldLegend: 'Sold',
    wheelchairLegend: 'Wheelchair',
    maxSeatsReached: 'You can select up to 6 seats per booking.',
    seatDeselectedToast: (seatLabel: string) => `${seatLabel} is no longer available and was deselected.`,
    conflictToast: 'One or more selected seats were taken by another user.',
    serviceUnavailableToast: 'Seat hold service temporarily unavailable. Please retry.',
    proceedToCheckout: 'Proceed to checkout',
    selectedCount: (count: number) => `${count} seat${count === 1 ? '' : 's'} selected`,
    seatAccessibilityLabel: (row: string, num: number, state: string, accessible: boolean) =>
      `Row ${row}, seat ${num}, ${accessible ? 'wheelchair accessible, ' : ''}${state}`,
  },

  waitingRoom: {
    title: 'Waiting Room',
    subtitle: 'High demand for this showtime. You have been placed in the waiting room.',
    rankLabel: 'Your position in line',
    estimatedWaitLabel: 'Estimated wait time',
    admittedMessage: 'You are admitted! Securing your seats now…',
    spotOpensMessage: 'We will let you in as soon as a spot opens.',
    secondsRemaining: (s: number) => (s === 1 ? '~1 second' : `~${s} seconds`),
  },

  checkout: {
    title: 'Checkout',
    testModeBadge: 'TEST MODE',
    priceBreakdownHeader: 'Order Summary',
    ticketsLine: (count: number) => `Tickets (${count}x)`,
    serviceFeeLine: 'Service Fee',
    totalLine: 'Total Amount',
    holdCountdown: (minutes: number, seconds: number) =>
      `Hold expires in ${minutes}:${seconds.toString().padStart(2, '0')}`,
    holdExpiredTitle: 'Hold Expired',
    holdExpiredMessage: 'Your seat hold has expired. Please select your seats again.',
    cancellationRefundPolicy:
      'In the event of a showtime cancellation, payments are automatically refunded to your original payment method via our immutable ledger.',
    payWithFlutterwave: 'Pay with Flutterwave',
    releaseSeatsAction: 'Release seats',
    confirmingPaymentTitle: 'Confirming Payment',
    confirmingPaymentMessage: 'Awaiting payment confirmation from Flutterwave…',
    confirmationStillPending:
      'Payment is still confirming. Your tickets will appear in My tickets shortly.',
    viewMyTicketsAction: 'Go to My tickets',
    paymentFailedTitle: 'Payment Incomplete',
    paymentFailedMessage: 'Payment was not completed. Your seats have been released.',
  },

  tickets: {
    myTicketsHeader: 'My Tickets',
    emptyTicketsTitle: 'No Tickets Yet',
    emptyTicketsMessage:
      'You have not booked any cinema tickets yet. Explore now playing movies and reserve your view.',
    browseMoviesAction: 'Browse movies',
    ticketDetailTitle: 'Cinema Ticket',
    qrRefreshAction: 'Refresh QR',
    qrSecurityNote: 'Present this QR code at the cinema entrance. Dynamic security refreshes on every open.',
    activeStatus: 'Active',
    usedStatus: 'Used',
    cancelledStatus: 'Cancelled',
    usedAtTime: (time: string) => `Used at ${time}`,
    cancelledRefundNotice: 'Showtime cancelled. Amount auto-refunded to original payment method via ledger.',
  },

  account: {
    gracePeriodDays: ACCOUNT_DELETION_GRACE_DAYS,
    menuAction: 'Account menu',
    menuAccessibilityLabel: 'Account menu',
    menuAccessibilityHint: 'Opens account options menu',
    signOutAction: 'Sign out',
    deleteAccountAction: 'Delete account',
    deleteConfirmTitle: 'Delete Account',
    deleteStep1Prompt: 'To confirm deletion, type DELETE below:',
    deleteStep1Placeholder: 'DELETE',
    deleteStep2Prompt: 'Enter your password to authorize account deletion.',
    deleteGracePeriodNotice:
      `Your account will enter a ${ACCOUNT_DELETION_GRACE_DAYS}-day grace period and be permanently deleted after ${ACCOUNT_DELETION_GRACE_DAYS} days. Until then, sign in and tap Restore to keep it.`,
    deleteSubmitAction: 'Delete My Account',
    deleteCancelAction: 'Cancel',
    deleteNextAction: 'Continue',
    hasUpcomingTicketsError:
      'Cannot delete account with upcoming tickets. Please wait until your showtime has passed or cancel your tickets.',
    deleteSuccessTitle: 'Account deletion started',
    deleteSuccessMessage:
      `You have ${ACCOUNT_DELETION_GRACE_DAYS} days to Restore your account. After that, your account is deleted for good. You've been signed out.`,
    deleteSuccessAction: 'Got it',
    restorePromptTitle: 'Restore your account?',
    restorePromptMessage: (dateStr: string) =>
      `This account is scheduled for deletion on ${dateStr}. Restore it to keep using it.`,
    restoreAction: 'Restore account',
    cancelRestoreAction: 'Not now',
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

