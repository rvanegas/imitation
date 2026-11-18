import { APIError, BadRequestError } from '@anthropic-ai/sdk';

export function friendlyApiError(err: unknown): string | null {
  if (!(err instanceof APIError)) return null;
  if (err.message?.includes('credit balance')) {
    return 'The AI service is temporarily unavailable (billing issue). Please try again later.';
  }
  // A 400 is the request being refused, which no amount of waiting fixes:
  // calling it an outage is how a wrong parameter went unnoticed (2026-11-18).
  if (err instanceof BadRequestError) {
    return 'The AI service refused the request. That is a fault in the game, not an outage; it has been logged.';
  }
  return 'The AI service is temporarily unavailable. Please try again later.';
}
