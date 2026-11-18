import { z } from 'zod';
import { STRINGS } from '../constants/strings';
import { getSessionToken } from '../lib/secureStore';
import { handleUnauthorized } from '../lib/sessionExpired';

export type AssistantHistoryItem = {
  role: 'user' | 'assistant';
  text: string;
};

const assistantChatResponseSchema = z
  .object({
    reply: z.string(),
  })
  .strict();

export class AssistantClient {
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

    if (!isDev && !trimmed.startsWith('https://')) {
      throw new Error(STRINGS.common.genericError);
    }
    return trimmed;
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
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

    const controller = new AbortController();
    // Must outlast server-side attempts (max 15s primary + capped fallback, total <= 24s).
    const timeout = setTimeout(() => controller.abort(), 25000);

    try {
      const response = await fetch(url, {
        ...options,
        headers,
        signal: controller.signal,
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        // Authenticated call: a 401 clears the session and triggers the app's expiry flow.
        await handleUnauthorized(response.status);
        const errorMsg = data?.error?.message || STRINGS.common.genericError;
        const error = new Error(errorMsg) as any;
        error.code = data?.error?.code;
        error.status = response.status;
        const retryAfterHeader = response.headers?.get?.('retry-after');
        if (retryAfterHeader) {
          const parsed = parseInt(retryAfterHeader, 10);
          if (!isNaN(parsed)) {
            error.retryAfter = parsed;
          }
        }
        throw error;
      }

      return data as T;
    } catch (err: any) {
      if (err.name === 'AbortError') {
        const timeoutError = new Error('Request timed out. Please check your connection.') as any;
        timeoutError.name = 'AbortError';
        timeoutError.status = 0;
        throw timeoutError;
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  public async sendChat(input: {
    message: string;
    history?: AssistantHistoryItem[];
  }): Promise<{ reply: string }> {
    const history = (input.history ?? []).slice(-4).map((item) => ({
      role: item.role,
      text: item.text,
    }));

    const data = await this.request<unknown>('/assistant/chat', {
      method: 'POST',
      body: JSON.stringify({
        message: input.message,
        ...(history.length > 0 ? { history } : {}),
      }),
    });

    return assistantChatResponseSchema.parse(data);
  }
}

export const assistantClient = new AssistantClient();
