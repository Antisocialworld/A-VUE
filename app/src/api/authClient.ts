import {
  RequestResetInput,
  ResetPasswordInput,
  SignInInput,
  SignUpInput,
  VerifyCodeInput,
  requestResetSchema,
  resetPasswordSchema,
  signInSchema,
  signUpSchema,
  verifyCodeSchema,
} from '../schemas/auth';
import { STRINGS } from '../constants/strings';
import {
  deleteSessionToken,
  getSessionToken,
  saveSessionToken,
} from '../lib/secureStore';

export interface AuthSession {
  token: string;
  user: {
    id: string;
    email: string;
    status?: 'active' | 'locked';
  };
}

export class AuthClient {
  private getBaseUrl(): string {
    const url = process.env.EXPO_PUBLIC_API_URL;
    const isDev = typeof __DEV__ !== 'undefined' ? __DEV__ : process.env.NODE_ENV !== 'production';

    if (!url || !url.trim()) {
      if (isDev) {
        throw new Error(
          'EXPO_PUBLIC_API_URL environment variable is missing. Please define EXPO_PUBLIC_API_URL in app/.env',
        );
      }
      throw new Error(STRINGS.common.genericError);
    }
    const trimmed = url.trim();

    // In production (not __DEV__), require https and refuse http (Task 8)
    if (!isDev && !trimmed.startsWith('https://')) {
      throw new Error(STRINGS.common.genericError);
    }
    return trimmed;
  }

  private mapServerErrorCode(code?: string, rawMessage?: string): string {
    switch (code) {
      case 'INVALID_CREDENTIALS':
        return STRINGS.signIn.invalidCredentialsError;
      case 'CODE_EXPIRED':
        return STRINGS.verifyCode.codeExpiredError;
      case 'MAX_ATTEMPTS_EXCEEDED':
        return STRINGS.verifyCode.maxAttemptsError;
      case 'DAILY_CAP_REACHED':
        return STRINGS.verifyCode.dailyCapReachedError;
      case 'COOLDOWN_ACTIVE': {
        const match = rawMessage?.match(/\d+/);
        const seconds = match ? parseInt(match[0], 10) : 60;
        return STRINGS.verifyCode.resendCooldown(seconds);
      }
      default: {
        const lower = rawMessage?.toLowerCase() || '';
        if (lower.includes('cooldown') || lower.includes('wait') || lower.includes('second')) {
          const match = rawMessage?.match(/\d+/);
          const seconds = match ? parseInt(match[0], 10) : 60;
          return STRINGS.verifyCode.resendCooldown(seconds);
        }
        if (lower.includes('attempt')) {
          const match = rawMessage?.match(/\d+/);
          const remaining = match ? parseInt(match[0], 10) : 1;
          return STRINGS.verifyCode.wrongCodeError(remaining);
        }
        return STRINGS.common.genericError;
      }
    }
  }

  private async request<T>(
    path: string,
    options: RequestInit = {},
  ): Promise<T> {
    const url = `${this.getBaseUrl()}${path}`;
    const token = await getSessionToken();

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(options.headers as Record<string, string>),
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    // 10s request timeout per Rule 02 & Task 5
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    let res: Response;
    try {
      res = await fetch(url, {
        ...options,
        headers,
        signal: controller.signal,
      });
    } catch {
      // Network errors, timeouts, or 5xx never log the user out (Rule 02)
      throw new Error(STRINGS.common.genericError);
    } finally {
      clearTimeout(timeoutId);
    }

    // Only an explicit 401 clears the stored session token (Rule 02)
    if (res.status === 401) {
      await deleteSessionToken();
      let errorBody: any = null;
      try {
        errorBody = await res.json();
      } catch {
        // Ignore json parse error
      }
      const mappedMsg = this.mapServerErrorCode(
        errorBody?.error?.code,
        errorBody?.error?.message,
      );
      throw new Error(mappedMsg);
    }

    if (!res.ok) {
      let errorBody: any = null;
      try {
        errorBody = await res.json();
      } catch {
        // Ignore json parse error
      }
      const mappedMsg = this.mapServerErrorCode(
        errorBody?.error?.code,
        errorBody?.error?.message,
      );
      throw new Error(mappedMsg);
    }

    return (await res.json()) as T;
  }

  async signIn(input: SignInInput): Promise<AuthSession> {
    const validated = signInSchema.parse(input);
    const data = await this.request<{
      token: string;
      user: { id: string; email: string; status?: 'active' | 'locked' };
    }>('/auth/signin', {
      method: 'POST',
      body: JSON.stringify(validated),
    });

    await saveSessionToken(data.token);
    return {
      token: data.token,
      user: data.user,
    };
  }

  async signUp(
    input: SignUpInput,
  ): Promise<{ requiresVerification: true; email: string }> {
    const validated = signUpSchema.parse(input);
    await this.request<{ message: string; email: string }>('/auth/signup', {
      method: 'POST',
      body: JSON.stringify(validated),
    });

    return {
      requiresVerification: true,
      email: validated.email,
    };
  }

  async verifySignUpCode(input: VerifyCodeInput): Promise<AuthSession> {
    const validated = verifyCodeSchema.parse(input);
    const data = await this.request<{
      token: string;
      user: { id: string; email: string; status?: 'active' | 'locked' };
    }>('/auth/verify-code', {
      method: 'POST',
      body: JSON.stringify(validated),
    });

    await saveSessionToken(data.token);
    return {
      token: data.token,
      user: data.user,
    };
  }

  async resendSignUpCode(
    email: string,
  ): Promise<{ sent: true; cooldownSeconds: number }> {
    const validatedEmail = signUpSchema.shape.email.parse(email);
    const data = await this.request<{
      message: string;
      cooldownSeconds: number;
    }>('/auth/resend-code', {
      method: 'POST',
      body: JSON.stringify({ email: validatedEmail }),
    });

    return {
      sent: true,
      cooldownSeconds: data.cooldownSeconds || 60,
    };
  }

  async requestPasswordReset(
    input: RequestResetInput,
  ): Promise<{ sent: true; cooldownSeconds: number }> {
    const validated = requestResetSchema.parse(input);
    const data = await this.request<{
      message: string;
      cooldownSeconds: number;
    }>('/auth/reset-request', {
      method: 'POST',
      body: JSON.stringify(validated),
    });

    return {
      sent: true,
      cooldownSeconds: data.cooldownSeconds || 60,
    };
  }

  async resetPassword(
    input: ResetPasswordInput,
  ): Promise<{ success: true }> {
    const validated = resetPasswordSchema.parse(input);
    await this.request<{ message: string }>('/auth/reset-confirm', {
      method: 'POST',
      body: JSON.stringify(validated),
    });

    return { success: true };
  }

  async signOut(): Promise<void> {
    try {
      await this.request('/auth/signout', { method: 'POST' });
    } catch {
      // Clear client session even if backend signout network call fails
    } finally {
      await deleteSessionToken();
    }
  }

  async me(): Promise<{ user: { id: string; email: string } } | null> {
    try {
      return await this.request<{
        user: { id: string; email: string };
      }>('/auth/me', { method: 'GET' });
    } catch {
      return null;
    }
  }

  async getMe(): Promise<{ user: { id: string; email: string } } | null> {
    return this.me();
  }
}

export const authClient = new AuthClient();
