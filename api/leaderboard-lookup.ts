import { getLeaderboardPage, getPlayerStats, REGION_MAP } from '../src/utils/scraper.js';
import { playerCache } from '../src/utils/cache.js';
import { isRateLimited } from '../src/utils/ip-limiter.js';
import type { LookupRequest, LookupResponse, PlayerStats } from '../src/types/index.js';

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

const ERROR_CODES = {
  INVALID_REGION: 'INVALID_REGION',
  INVALID_RANK: 'INVALID_RANK',
  LEADERBOARD_FETCH_FAILED: 'LEADERBOARD_FETCH_FAILED',
  PLAYER_NOT_FOUND: 'PLAYER_NOT_FOUND',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  INVALID_RIOT_ID: 'INVALID_RIOT_ID'
} as const;

const PUBLIC_ERROR_MESSAGES: Record<string, string> = {
  [ERROR_CODES.INVALID_REGION]: 'Invalid server region specified',
  [ERROR_CODES.INVALID_RANK]: 'Invalid rank number provided',
  [ERROR_CODES.LEADERBOARD_FETCH_FAILED]: 'Unable to fetch leaderboard data',
  [ERROR_CODES.PLAYER_NOT_FOUND]: 'Player profile not found or is private',
  [ERROR_CODES.RATE_LIMITED]: 'Too many requests. Please try again later.',
  [ERROR_CODES.INTERNAL_ERROR]: 'An error occurred. Please try again.',
  [ERROR_CODES.INVALID_RIOT_ID]: 'Invalid Riot ID format'
};

function createErrorResponse(errorCode: string, status: number = 400): Response {
  const message = PUBLIC_ERROR_MESSAGES[errorCode] || PUBLIC_ERROR_MESSAGES[ERROR_CODES.INTERNAL_ERROR];
  return new Response(JSON.stringify({ success: false, error: message, code: errorCode }), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders }
  });
}

function logError(level: 'error' | 'warn' | 'info', message: string, data?: unknown): void {
  const logEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...(data ? { data } : {})
  };

  if (process.env.NODE_ENV !== 'production' || level === 'error') {
    console[level](JSON.stringify(logEntry));
  }
}

function isValidIP(ip: string): boolean {
  const ipv4Pattern = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
  const ipv6Pattern = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/;
  return ipv4Pattern.test(ip) || ipv6Pattern.test(ip);
}

function getTrustedClientIP(directIP: string | undefined, headers: Headers): string {
  const trustedProxies = ['127.0.0.1', '::1', 'localhost'];

  if (directIP && trustedProxies.includes(directIP)) {
    const forwardedFor = headers.get("x-forwarded-for");
    if (forwardedFor) {
      const ips = forwardedFor.split(',').map((s: string) => s.trim());
      const ip = ips[ips.length - 1];
      return isValidIP(ip) ? ip : directIP;
    }
    const xRealIp = headers.get("x-real-ip");
    if (xRealIp && isValidIP(xRealIp)) {
      return xRealIp;
    }
  }

  return directIP || "unknown";
}

export async function handler(request: Request, clientIP?: string) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
  }

  const server = (request as { server?: { requestIP?: (req: Request) => { address?: string } } }).server;
  const directIP = server?.requestIP?.(request)?.address || clientIP || "unknown";

  if (!isValidIP(directIP)) {
    return createErrorResponse(ERROR_CODES.INTERNAL_ERROR, 400);
  }

  const ip = getTrustedClientIP(directIP, request.headers);

  if (isRateLimited(ip)) {
    return createErrorResponse(ERROR_CODES.RATE_LIMITED, 429);
  }

  try {
    const body: LookupRequest = await request.json();
    const { ranks, region } = body;

    if (!region || !REGION_MAP[region]) {
      return createErrorResponse(ERROR_CODES.INVALID_REGION, 400);
    }

    if (!ranks || !Array.isArray(ranks)) {
      return createErrorResponse(ERROR_CODES.INVALID_RANK, 400);
    }

    if (ranks.length > 10) {
      return createErrorResponse(ERROR_CODES.INVALID_RANK, 400);
    }

    for (const input of ranks) {
      const str = String(input).trim();
      if (!str.includes('#')) {
        const r = Number(str);
        if (!isNaN(r) && (r < 1 || r > 999999)) {
          return createErrorResponse(ERROR_CODES.INVALID_RANK, 400);
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
        const cacheKey = `leaderboard:${region}:${page}`;
        let items = await playerCache.get<Array<{ rank: number, owner: { metadata?: { platformUserHandle?: string; platformUserIdentifier?: string }; id?: string } }>>(cacheKey);

        if (!items) {
          items = await getLeaderboardPage(page, region);
          if (items) {
            await playerCache.set(cacheKey, items);
          }
        } else {
          console.log(`[CACHE] Hit for page ${page} in region ${region}`);
        }

        if (!items) {
          for (const rank of ranksOnPage) {
            errors.push({ rank_input: rankMap.get(rank)!, error: 'Failed to fetch leaderboard' });
          }
          return [];
        }

        const foundPlayers: { rank: number, riotId: string }[] = [];

        for (const rank of ranksOnPage) {
          const playerItem = items.find((item) => item.rank === rank);
          if (playerItem) {
            const riotId = playerItem.owner?.metadata?.platformUserHandle ||
              playerItem.owner?.metadata?.platformUserIdentifier ||
              playerItem.owner?.id;

            if (riotId) {
              foundPlayers.push({ rank, riotId });
            } else {
              errors.push({ rank_input: rankMap.get(rank)!, error: 'Failed to fetch leaderboard' });
            }
          } else {
            errors.push({ rank_input: rankMap.get(rank)!, error: 'Failed to fetch leaderboard' });
          }
        }
        return foundPlayers;
      } catch {
        logError('error', 'Page task error', { page, ranksOnPage });
        for (const rank of ranksOnPage) {
          errors.push({ rank_input: rankMap.get(rank)!, error: 'Failed to fetch leaderboard' });
        }
        return [];
      }
    });

    const pageResults = await Promise.all(pageTasks);

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

      try {
        const fetchedStats = await getPlayerStats(riotId);

        if (!fetchedStats) {
          errors.push({ rank_input: rankInput, error: 'Failed to fetch leaderboard' });
          return;
        }

        const stats = {
          rank_input: rankInput,
          ...fetchedStats,
          cached: false
        } as PlayerStats;

        results.push(stats);
      } catch {
        logError('error', 'Stats task error', { riotId });
        errors.push({ rank_input: rankInput, error: 'Failed to fetch leaderboard' });
      }
    });

    await Promise.all(statTasks);

    const response: LookupResponse = {
      success: true,
      data:      results.sort((a, b) => {
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
      headers: { 
        'Content-Type': 'application/json',
        ...corsHeaders 
      }
    });

  } catch (e) {
    logError('error', 'Handler error', { error: e instanceof Error ? e.message : String(e) });
    return new Response(JSON.stringify({ success: false, code: ERROR_CODES.INTERNAL_ERROR }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  }
}

export default async function(req: { method: string; headers: Record<string, string>; url: string; body?: unknown }, res: { status(code: number): { json: (data: unknown) => void }; setHeader: (key: string, value: string) => void; send: (data: string) => void }) {
  const protocol = req.headers['x-forwarded-proto'] || 'http';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const url = `${protocol}://${host}${req.url}`;

  let body: string | null = null;
  if (req.body) {
    if (typeof req.body === 'object') {
      body = JSON.stringify(req.body);
    } else {
      body = String(req.body);
    }
  }

  const webReq = new Request(url, {
    method: req.method,
    headers: req.headers as HeadersInit,
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
