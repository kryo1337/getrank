import type { PlayerStats, Region } from '../types/index.js';

const ACT_ID = process.env.VALORANT_ACT_ID || '4c4b8cff-43eb-13d3-8f14-96b783c90cd2';

export const REGION_MAP: Record<Region, string> = {
  'na': 'na',
  'eu': 'eu',
  'ap': 'ap',
  'kr': 'kr',
  'br': 'br',
  'latam': 'latam'
};

interface SanitizedRiotId {
  isValid: boolean;
  sanitized?: string;
  error?: string;
}

function sanitizeRiotId(riotId: string): SanitizedRiotId {
  const str = String(riotId).trim();
  
  if (str.length === 0 || str.length > 100) {
    return { isValid: false, error: 'Riot ID must be 1-100 characters' };
  }
  
  if (!str.includes('#')) {
    return { isValid: false, error: 'Riot ID must include # separator' };
  }
  
  const parts = str.split('#');
  if (parts.length !== 2) {
    return { isValid: false, error: 'Riot ID must have exactly one # separator' };
  }
  
  const [name, tag] = parts;
  
  if (name.length < 3 || name.length > 20) {
    return { isValid: false, error: 'Name must be 3-20 characters' };
  }
  
  if (tag.length < 3 || tag.length > 5) {
    return { isValid: false, error: 'Tag must be 3-5 characters' };
  }
  
  const namePattern = /^[\p{L}\p{N}\s]+$/u;
  const tagPattern = /^[\p{L}\p{N}]+$/u;
  
  if (!namePattern.test(name)) {
    return { isValid: false, error: 'Name contains invalid characters' };
  }
  
  if (!tagPattern.test(tag)) {
    return { isValid: false, error: 'Tag must contain only letters and numbers' };
  }
  
  return { isValid: true, sanitized: str };
}

function validateActId(actId: string): boolean {
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidPattern.test(actId);
}

interface LeaderboardItem {
  rank: number;
  owner: {
    metadata?: {
      platformUserHandle?: string;
      platformUserIdentifier?: string;
    };
    id?: string;
  };
}

async function getLeaderboardViaPython(region: string, page: number): Promise<LeaderboardItem[] | null> {
  const allowedRegions = ['na', 'eu', 'ap', 'kr', 'br', 'latam'];
  const normalizedRegion = region.toLowerCase().trim();
  
  if (!allowedRegions.includes(normalizedRegion)) {
    console.error(`[LEADERBOARD] Invalid region: ${normalizedRegion}`);
    return null;
  }
  
  if (!Number.isInteger(page) || page < 1 || page > 10000) {
    console.error(`[LEADERBOARD] Invalid page: ${page}`);
    return null;
  }

  try {
    const proc = Bun.spawn([
      "python3",
      "python/leaderboard_scraper.py",
      normalizedRegion,
      page.toString(),
      ACT_ID
    ], {
      cwd: process.cwd(),
      stderr: "inherit"
    });

    const output = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      console.error(`[LEADERBOARD] Process failed with exit code ${exitCode}`);
      return null;
    }

    const data = JSON.parse(output.trim());
    if (data && data.items) {
      console.log(`[LEADERBOARD] Success for page ${page}`);
      return data.items.map((item: { rank: number; riotId: string }) => ({
        rank: item.rank,
        owner: {
          metadata: {
            platformUserHandle: item.riotId
          }
        }
      }));
    }

    if (data && data.error) {
      console.warn(`[LEADERBOARD] Error: ${data.error}`);
    }

    return null;
  } catch (e) {
    console.error(`[LEADERBOARD] Failed:`, e);
    return null;
  }
}

export async function getLeaderboardPage(page: number, region: Region): Promise<LeaderboardItem[] | null> {
  const regionParam = REGION_MAP[region];
  console.log(`[LEADERBOARD] Fetching page ${page} for ${region}...`);
  
  if (!regionParam) {
    console.error(`[LEADERBOARD] Invalid region mapping: ${region}`);
    return null;
  }
  
  return await getLeaderboardViaPython(regionParam, page);
}

export async function getPlayerByRank(rank: number, region: Region): Promise<{ riotId: string } | null> {
  const page = Math.ceil(rank / 100);
  const items = await getLeaderboardPage(page, region);

  if (items) {
    const playerItem = items.find((item) => item.rank === rank);
    if (playerItem) {
      const riotId = playerItem.owner?.metadata?.platformUserHandle ||
        playerItem.owner?.metadata?.platformUserIdentifier ||
        playerItem.owner?.id;
      if (riotId) return { riotId };
    }
  }
  return null;
}

async function getPlayerStatsViaPython(riotId: string): Promise<Partial<PlayerStats> | null> {
  const sanitization = sanitizeRiotId(riotId);
  if (!sanitization.isValid || !sanitization.sanitized) {
    return { error: sanitization.error || 'Invalid Riot ID format' };
  }

  const sanitizedId = sanitization.sanitized;
  
  try {
    const proc = Bun.spawn([
      "python3", 
      "python/stats_scraper.py", 
      "profile", 
      sanitizedId
    ], {
      cwd: process.cwd(),
      stderr: "inherit"
    });

    const output = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      console.error(`[STATS] Process failed for ${sanitizedId} with exit code ${exitCode}`);
      return null;
    }

    const data = JSON.parse(output.trim());

    if (data && data.error) {
      return { error: data.error };
    }

    if (data && !data.error) {
      console.log(`[STATS] Success for ${sanitizedId}`);
      return data;
    }
    return null;
  } catch (e) {
    console.error(`[STATS] Failed for ${sanitizedId}:`, e);
    return null;
  }
}

export async function getPlayerStats(riotId: string): Promise<Partial<PlayerStats> | null> {
  if (!validateActId(ACT_ID)) {
    return { error: 'Invalid Act ID configuration' };
  }
  
  const pythonStats = await getPlayerStatsViaPython(riotId);
  
  if (pythonStats) {
    if (pythonStats.error) {
      console.warn(`[STATS] Returned error for ${riotId}: ${pythonStats.error}`);
    }
    return pythonStats;
  }
  
  return { error: 'Scraping failed' };
}
