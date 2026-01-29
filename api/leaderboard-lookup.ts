import { getLeaderboardPage, getPlayerStats, REGION_MAP } from '../src/utils/scraper';
import { getPlayerStatsAPI } from '../src/utils/tracker-api';
import { playerCache } from '../src/utils/cache';
import { isRateLimited } from '../src/utils/ip-limiter';
import type { LookupRequest, LookupResponse, PlayerStats } from '../src/types';

export const config = {
  runtime: 'nodejs',
  maxDuration: 60,
};

const allowedOrigin = (process.env.ALLOWED_ORIGIN || '*').replace(/\/$/, "");

const corsHeaders = {
  'Access-Control-Allow-Origin': allowedOrigin,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// Web Standard Handler (for Bun / server.ts)
export async function handler(request: Request) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
  }

  const clientIP = request.headers.get("x-forwarded-for") || "unknown";
  if (isRateLimited(clientIP)) {
    return new Response(JSON.stringify({ success: false, error: 'Too Many Requests' }), {
      status: 429,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  }

  try {
    const body: LookupRequest = await request.json();
    const { ranks, region } = body;

    if (!region || !REGION_MAP[region]) {
      return new Response(JSON.stringify({ success: false, error: 'Invalid region' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    if (!ranks || !Array.isArray(ranks)) {
      return new Response(JSON.stringify({ success: false, errors: [], data: [] }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    if (ranks.length > 10) {
      return new Response(JSON.stringify({ success: false, error: 'Request limit exceeded: Max 10 ranks allowed per query.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    // Validate rank range (1-999999)
    for (const input of ranks) {
        const str = String(input).trim();
        if (!str.includes('#')) {
            const r = Number(str);
            if (!isNaN(r) && (r < 1 || r > 999999)) {
                return new Response(JSON.stringify({ success: false, error: `Rank ${r} must be between 1 and 999999.` }), {
                    status: 400,
                    headers: { 'Content-Type': 'application/json', ...corsHeaders }
                });
            }
        }
    }

    const results: PlayerStats[] = [];
    const errors: Array<{ rank_input: string | number; error: string }> = [];
    
    const pagesToFetch = new Map<number, number[]>();
    const rankMap = new Map<number, string | number>();
    const directLookups: { rank_input: string, riotId: string }[] = [];

    for (const input of ranks) {
        const inputStr = String(input).trim();
        
        if (inputStr.includes('#')) {
            directLookups.push({ 
                rank_input: inputStr, 
                riotId: inputStr 
            });
            continue;
        }

        const rank = Number(inputStr);
        if (isNaN(rank)) {
            errors.push({ rank_input: input, error: 'Invalid input format' });
            continue;
        }
        
        rankMap.set(rank, input);
        const page = Math.ceil(rank / 100);
        
        if (!pagesToFetch.has(page)) {
            pagesToFetch.set(page, []);
        }
        pagesToFetch.get(page)?.push(rank);
    }

    const pageTasks = Array.from(pagesToFetch.entries()).map(async ([page, ranksOnPage]) => {
        try {
            const items = await getLeaderboardPage(page, region);
            if (!items) {
                for (const rank of ranksOnPage) {
                    errors.push({ rank_input: rankMap.get(rank)!, error: 'Failed to fetch leaderboard page' });
                }
                return [];
            }
            
            const foundPlayers: { rank: number, riotId: string }[] = [];
            
            for (const rank of ranksOnPage) {
                const playerItem = items.find((item: any) => item.rank === rank);
                if (playerItem) {
                     const riotId = playerItem.owner?.metadata?.platformUserHandle || 
                                    playerItem.owner?.metadata?.platformUserIdentifier || 
                                    playerItem.owner?.id;
                     
                     if (riotId) {
                         foundPlayers.push({ rank, riotId });
                     } else {
                         errors.push({ rank_input: rankMap.get(rank)!, error: 'Riot ID not found in leaderboard data' });
                     }
                } else {
                    errors.push({ rank_input: rankMap.get(rank)!, error: 'Rank not found on leaderboard' });
                }
            }
            return foundPlayers;
        } catch (e) {
            console.error(`Page task error`, e);
            for (const rank of ranksOnPage) {
                errors.push({ rank_input: rankMap.get(rank)!, error: 'Internal error fetching leaderboard' });
            }
            return [];
        }
    });

    const pageResults = await Promise.all(pageTasks);
    
    // Normalize types for the combined list
    const leaderboardPlayers = pageResults.flat()
        .filter(p => rankMap.has(p.rank))
        .map(p => ({
            rank: p.rank,
            riotId: p.riotId,
            inputOverride: undefined as string | undefined
        }));

    const directPlayers = directLookups.map(d => ({ 
        rank: 0, 
        riotId: d.riotId, 
        inputOverride: d.rank_input 
    }));

    const playersToFetch = [...leaderboardPlayers, ...directPlayers];
    
    const statTasks = playersToFetch.map(async ({ rank, riotId, inputOverride }) => {
        const rankInput = inputOverride || rankMap.get(rank)!;
        const cacheKey = `player:${region}:${riotId}`;
        
        try {
            let stats = await playerCache.get<PlayerStats>(cacheKey);
            
            if (!stats) {
                let fetchedStats: Partial<PlayerStats> | null = null;
                const useScraper = process.env.SCRAPER === 'TRUE';
                
                if (!useScraper && process.env.TRN_API_KEY) {
                    fetchedStats = await getPlayerStatsAPI(riotId);
                } 
                
                if (!fetchedStats) {
                    if (!useScraper && process.env.TRN_API_KEY) {
                        console.warn(`API failed or returned null for ${riotId}, falling back to scraper`);
                    }
                    fetchedStats = await getPlayerStats(riotId);
                }

                if (!fetchedStats) {
                    errors.push({ rank_input: rankInput, error: 'Failed to fetch player stats (Private profile?)' });
                    return;
                }
                
                stats = {
                    rank_input: rankInput,
                    ...fetchedStats,
                    cached: false
                } as PlayerStats;
                
                await playerCache.set(cacheKey, stats);
            } else {
                stats = { ...stats, rank_input: rankInput, cached: true };
            }
            
            results.push(stats);
        } catch (e) {
            console.error(`Stats task error for ${riotId}`, e);
            errors.push({ rank_input: rankInput, error: 'Internal error fetching stats' });
        }
    });
    
    await Promise.all(statTasks);

    const response: LookupResponse = {
      success: true,
      data: results.sort((a, b) => {
          const aNum = Number(a.rank_input);
          const bNum = Number(b.rank_input);
          
          if (!isNaN(aNum) && !isNaN(bNum)) {
              return aNum - bNum;
          }
          
          if (!isNaN(aNum) && isNaN(bNum)) {
              return -1;
          }
          
          if (isNaN(aNum) && !isNaN(bNum)) {
              return 1;
          }
          
          return String(a.rank_input).localeCompare(String(b.rank_input));
      }),
      errors: errors
    };

    return new Response(JSON.stringify(response), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });

  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ success: false, error: 'Server Error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  }
}

// Vercel / Node.js Adapter (Default Export)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default async function (req: any, res: any) {
  const protocol = req.headers['x-forwarded-proto'] || 'http';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const url = `${protocol}://${host}${req.url}`;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: any = null;
  if (req.body) {
     if (typeof req.body === 'object') {
         body = JSON.stringify(req.body);
     } else {
         body = req.body;
     }
  }

  const webReq = new Request(url, {
    method: req.method,
    headers: req.headers,
    body: (req.method === 'GET' || req.method === 'HEAD') ? null : body,
  });

  try {
    const webRes = await handler(webReq);

    res.status(webRes.status);
    webRes.headers.forEach((value, key) => {
      res.setHeader(key, value);
    });
    
    const responseText = await webRes.text();
    res.send(responseText);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Internal Server Error' });
  }
}
