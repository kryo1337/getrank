export interface PlayerStats {
  rank_input: number | string;
  riot_id: string;
  current_rank: string;
  kd: string;
  wr: string;
  games_played: number;
  wins: number;
  tracker_url: string;
  cached: boolean;
  error?: string;
}

export interface LookupRequest {
  ranks: (number | string)[];
  region: Region;
}

export interface LookupResponse {
  success: boolean;
  data: PlayerStats[];
  errors: Array<{
    rank_input: number | string;
    error: string;
  }>;
}

export type Region = 'na' | 'eu' | 'ap' | 'kr' | 'br' | 'latam';
