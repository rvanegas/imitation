import { APIError } from '@anthropic-ai/sdk';

export function friendlyApiError(err: unknown): string | null {
  if (!(err instanceof APIError)) return null;
  if (err.message?.includes('credit balance')) {
    return 'The AI service is temporarily unavailable (billing issue). Please try again later.';
  }
  return 'The AI service is temporarily unavailable. Please try again later.';
}
