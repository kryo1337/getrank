import type { PlayerStats } from '../types';

const API_KEY = process.env.TRN_API_KEY;
const BASE_URL = 'https://public-api.tracker.gg/v2/valorant/standard';

interface TrackerResponse {
  data: {
    platformInfo: {
      platformUserHandle: string;
      platformUserIdentifier: string;
      avatarUrl: string;
    };
    segments: Array<{
      type: string;
      metadata: {
        name: string;
      };
      stats: {
        rank: { displayValue: string; metadata: { tierName: string }; value: number };
        kDRatio: { value: number; displayValue: string };
        wlRatio: { value: number; displayValue: string };
        matchesWinPct: { value: number; displayValue: string };
        matchesPlayed: { value: number; displayValue: string };
        matchesWon: { value: number; displayValue: string };
      };
    }>;
  };
}

export async function getPlayerStatsAPI(riotId: string): Promise<Partial<PlayerStats> | null> {
  if (!API_KEY) {
    console.warn('TRN_API_KEY is not set');
    return null;
  }

  const encodedId = encodeURIComponent(riotId);
  const url = `${BASE_URL}/profile/riot/${encodedId}`;

  try {
    const response = await fetch(url, {
      headers: {
        'TRN-Api-Key': API_KEY,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      if (response.status === 404) return null; // Player not found or private
      if (response.status === 401) console.error('Invalid TRN_API_KEY');
      if (response.status === 429) console.error('TRN API Rate Limit Exceeded');
      console.error(`TRN API Error: ${response.status} ${response.statusText}`);
      return null;
    }

    const json = await response.json() as TrackerResponse;
    const data = json.data;

    const competitive = data.segments.find(
      (s) => (s.type === 'playlist' && s.metadata.name === 'Competitive') || s.type === 'overview'
    );

    if (!competitive) {
      return null;
    }

    const stats = competitive.stats;
    let rank = stats.rank?.displayValue || 'Unknown';
    
    if (stats.rank?.metadata?.tierName && stats.rank?.value) {
       if (!rank.includes('RR') && stats.rank.value > 0) {
           rank = `${stats.rank.metadata.tierName} ${stats.rank.value}RR`;
       }
    }

    const kd = stats.kDRatio?.displayValue || '0.00';
    const wr = stats.matchesWinPct?.displayValue || '0%';
    const wins = stats.matchesWon?.value || 0;
    const games = stats.matchesPlayed?.value || 0;

    return {
      riot_id: data.platformInfo.platformUserHandle,
      current_rank: rank,
      kd: kd,
      wr: wr,
      wins: wins,
      games_played: games,
      tracker_url: `https://tracker.gg/valorant/profile/riot/${encodedId}/overview`,
    };

  } catch (e) {
    console.error('Error fetching from TRN API:', e);
    return null;
  }
}
