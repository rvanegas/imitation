import { SERVER_URL } from './config';

// The leaderboard of the server `imitation terminal` plays on, read over
// plain HTTP from the same host, so it needs neither a sign-in nor a game.
export function leaderboardUrl(serverUrl: string): string {
  const url = new URL(serverUrl);
  url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
  url.pathname = '/leaderboard';
  url.search = '';
  return url.toString();
}

export async function showLeaderboard(): Promise<void> {
  const url = leaderboardUrl(SERVER_URL);
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    process.stdout.write(await res.text());
  } catch (err) {
    console.error(`Cannot read the leaderboard from ${url}: ${(err as Error).message}`);
    process.exit(1);
  }
}
