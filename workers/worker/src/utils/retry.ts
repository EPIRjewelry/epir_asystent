/**
 * workers/worker/src/utils/retry.ts
 * 
 * Retry logic and error handling utilities for MCP tool calls
 */

export interface RetryOptions {
  maxAttempts?: number;
  delayMs?: number;
  backoffMultiplier?: number;
  shouldRetry?: (error: any) => boolean;
}

const DEFAULT_OPTIONS: Required<RetryOptions> = {
  maxAttempts: 3,
  delayMs: 100,
  backoffMultiplier: 2,
  shouldRetry: (error: any) => {
    // Retry on network errors, timeouts, 5xx errors
    if (error instanceof TypeError) return true; // Network error
    if (error?.name === 'AbortError') return true; // Timeout
    if (typeof error === 'object' && error?.code >= 500 && error?.code < 600) return true;
    return false;
  }
};

/**
 * Execute async function with retry logic
 * 
 * @param fn - Async function to execute
 * @param options - Retry configuration
 * @returns Promise with result or throws last error
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: any;
  let delay = opts.delayMs;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Don't retry if it's the last attempt or error is not retryable
      if (attempt >= opts.maxAttempts || !opts.shouldRetry(error)) {
        throw error;
      }

      console.warn(`[withRetry] Attempt ${attempt}/${opts.maxAttempts} failed, retrying in ${delay}ms...`, {
        error: error instanceof Error ? error.message : String(error)
      });

      // Wait before next attempt
      await new Promise(resolve => setTimeout(resolve, delay));

      // Exponential backoff
      delay *= opts.backoffMultiplier;
    }
  }

  throw lastError;
}

/**
 * Check if error is a cart-related error that might be fixed by normalization
 */
export function isCartIdError(error: any): boolean {
  if (!error) return false;
  
  const errorMsg = typeof error === 'string' ? error : error?.message || '';
  const lowerMsg = errorMsg.toLowerCase();
  
  return (
    lowerMsg.includes('invalid cart_id') ||
    lowerMsg.includes('cart not found') ||
    lowerMsg.includes('invalid gid') ||
    lowerMsg.includes('pathspec') && lowerMsg.includes('.venv')
  );
}

/**
 * Build user-friendly error message for tool call failures
 */
export function buildToolErrorMessage(toolName: string, error: any): string {
  const baseMsg = `Nie udało się wykonać operacji "${toolName}"`;
  
  if (!error) return baseMsg + '.';
  
  const errorMsg = typeof error === 'string' ? error : error?.message || '';
  
  // Cart-related errors
  if (isCartIdError(error)) {
    return 'Nie mogę odczytać koszyka. Spróbuj odświeżyć stronę lub rozpocząć nowe zakupy.';
  }
  
  // Timeout errors
  if (error?.name === 'AbortError' || errorMsg.includes('timeout')) {
    return 'Operacja trwa zbyt długo. Sklep może być chwilowo niedostępny. Spróbuj ponownie za chwilę.';
  }
  
  // Network errors
  if (error instanceof TypeError) {
    return 'Problem z połączeniem. Sprawdź internet i spróbuj ponownie.';
  }
  
  // Generic server error
  if (typeof error === 'object' && error?.code >= 500) {
    return 'Sklep jest chwilowo niedostępny. Spróbuj ponownie za kilka minut.';
  }
  
  // Default
  return baseMsg + '. Spróbuj ponownie lub skontaktuj się z obsługą.';
}
