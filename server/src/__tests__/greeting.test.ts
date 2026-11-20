import { describe, expect, it } from 'vitest';
import { GREETING_TEXT, isGreeting } from '../lib/assistant/greeting.js';

describe('Ask A VUE whole-message greetings', () => {
  it.each([
    'hi',
    'Hello',
    'HEY!',
    'hi there',
    'hello there',
    'good morning',
    'good afternoon there',
    'good evening 👋',
    'hello, 😊',
    'Hi A VUE',
    'hey there A Vue!',
    'good morning A VUE',
    'hello there A VUE 🙌',
  ])('matches the greeting "%s"', (message) => {
    expect(isGreeting(message)).toBe(true);
  });

  it.each([
    'hello, who directed Inception',
    'hi, how do I book tickets?',
    'hey, what is a film score?',
    'good morning, show me a poster',
    'hiya',
    'hello there friend',
    'good day',
    'good evening A VUE and welcome',
    'what is a greeting?',
    '',
  ])('does not match the non-greeting "%s"', (message) => {
    expect(isGreeting(message)).toBe(false);
  });

  it('keeps the fixed reply copy deterministic', () => {
    expect(GREETING_TEXT).toBe(
      "Hi, I'm Ask A VUE. I can help with movies, posters and overviews, booking steps and general cinema questions.",
    );
  });
});
