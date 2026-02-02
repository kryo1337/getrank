import Redis from 'ioredis';

const WINDOW_MS = 60 * 1000;
const MAX_REQUESTS = 10;
const BLOCK_DURATION_MS = 15 * 60 * 1000;

const redisUrl = process.env.REDIS_URL || process.env.REDISCLOUD_URL;
const useRedis = !!redisUrl;

let redisClient: Redis | null = null;

if (useRedis) {
  try {
    redisClient = new Redis(redisUrl, {
      connectTimeout: 5000,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null
    });
    
    redisClient.on('error', (err: Error) => {
      console.error('[RATELIMIT] Redis error:', err);
    });
  } catch {
    console.error('[RATELIMIT] Failed to initialize Redis, falling back to in-memory');
  }
}

const ipRequestMap = new Map<string, number[]>();
const blockedIps = new Map<string, number>();

const CLEANUP_INTERVAL = 5 * 60 * 1000;
setInterval(() => {
  if (useRedis) return;
  
  const now = Date.now();
  const windowStart = now - WINDOW_MS;
  
  for (const [ip, requests] of ipRequestMap.entries()) {
    const recent = requests.filter(t => t > windowStart);
    if (recent.length === 0) {
      ipRequestMap.delete(ip);
    } else {
      ipRequestMap.set(ip, recent);
    }
  }
  
  for (const [ip, blockTime] of blockedIps.entries()) {
    if (now - blockTime > BLOCK_DURATION_MS) {
      blockedIps.delete(ip);
    }
  }
}, CLEANUP_INTERVAL);

interface RateLimitResult {
  limited: boolean;
  remaining: number;
  resetTime?: number;
}

async function checkRedisLimit(ip: string): Promise<RateLimitResult> {
  if (!redisClient) {
    return checkMemoryLimit(ip);
  }
  
  const now = Date.now();
  const key = `ratelimit:${ip}`;
  const blockedKey = `blocked:${ip}`;
  
  try {
    const blocked = await redisClient.get(blockedKey);
    if (blocked) {
      const resetTime = parseInt(blocked) + BLOCK_DURATION_MS;
      return { limited: true, remaining: 0, resetTime };
    }
    
    const count = await redisClient.incr(key);
    
    if (count === 1) {
      await redisClient.expire(key, Math.ceil(WINDOW_MS / 1000));
    }
    
    if (count > MAX_REQUESTS) {
      await redisClient.setex(blockedKey, Math.ceil(BLOCK_DURATION_MS / 1000), String(now));
      const resetTime = now + BLOCK_DURATION_MS;
      return { limited: true, remaining: 0, resetTime };
    }
    
    return { limited: false, remaining: MAX_REQUESTS - count };
  } catch (e) {
    console.error('[RATELIMIT] Redis error, falling back:', e);
    return checkMemoryLimit(ip);
  }
}

function checkMemoryLimit(ip: string): RateLimitResult {
  const now = Date.now();
  
  const blockTime = blockedIps.get(ip);
  if (blockTime && (now - blockTime < BLOCK_DURATION_MS)) {
    return { limited: true, remaining: 0, resetTime: blockTime + BLOCK_DURATION_MS };
  }
  
  blockedIps.delete(ip);
  
  const windowStart = now - WINDOW_MS;
  let requests = ipRequestMap.get(ip) || [];
  requests = requests.filter(time => time > windowStart);
  
  if (requests.length >= MAX_REQUESTS) {
    blockedIps.set(ip, now);
    return { limited: true, remaining: 0, resetTime: now + BLOCK_DURATION_MS };
  }
  
  requests.push(now);
  ipRequestMap.set(ip, requests);
  
  return { limited: false, remaining: MAX_REQUESTS - requests.length };
}

export async function isRateLimited(ip: string): Promise<RateLimitResult> {
  if (useRedis && redisClient) {
    return await checkRedisLimit(ip);
  }
  return Promise.resolve(checkMemoryLimit(ip));
}

export async function getRateLimitHeaders(ip: string): Promise<Record<string, string>> {
  const result = await isRateLimited(ip);
  const headers: Record<string, string> = {
    'X-RateLimit-Limit': String(MAX_REQUESTS),
    'X-RateLimit-Remaining': String(result.remaining),
    'X-RateLimit-Window': String(WINDOW_MS / 1000)
  };
  
  if (result.resetTime) {
    headers['X-RateLimit-Reset'] = String(Math.ceil(result.resetTime / 1000));
  }
  
  return headers;
}
