import { sleep } from "./sleep";

const DEFAULT_RETRIES = 3;
const DEFAULT_BACKOFF_FACTOR = 2;

export async function retryFetch(url: string, options?: RequestInit, retries = DEFAULT_RETRIES, backoffFactor = DEFAULT_BACKOFF_FACTOR): Promise<Response> {
  let lastError: any = null;
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, options);
      if (response.ok) {
        return response;
      } else if (response.status === 429) { // Too Many Requests
        const retryAfter = response.headers.get('Retry-After');
        const delay = retryAfter ? parseInt(retryAfter) * 1000 : Math.pow(backoffFactor, i) * 1000;
        console.warn(`Rate limited. Retrying after ${delay / 1000} seconds...`);
        await sleep(delay);
      } else {
        // For other non-OK responses, throw an error to retry (or fail if no retries left)
        throw new Error(`HTTP error! status: ${response.status} ${response.statusText}`);
      }
    } catch (error) {
      lastError = error;
      const delay = Math.pow(backoffFactor, i) * 1000;
      console.warn(`Fetch failed (${error}). Retrying after ${delay / 1000} seconds...`);
      await sleep(delay);
    }
  }
  throw lastError; // Re-throw the last error if all retries fail
}


