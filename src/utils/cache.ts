import RedisPkg from 'ioredis';

// @ts-expect-error - ioredis package type definitions
const Redis = RedisPkg.default || RedisPkg;

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

export interface CacheStore {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<void>;
  has(key: string): Promise<boolean>;
  destroy(): void;
  getStats?(): Record<string, unknown>;
}

export class InMemoryCache implements CacheStore {
  private cache: Map<string, CacheEntry<unknown>>;
  private ttl: number;
  private maxSize: number;
  private cleanupInterval: ReturnType<typeof setInterval>;

  constructor(ttlMs: number = 21600000, maxSize: number = 10000) {
    this.cache = new Map();
    this.ttl = ttlMs;
    this.maxSize = maxSize;
    
    this.cleanupInterval = setInterval(() => this.cleanup(), 30 * 60 * 1000);
  }

  async set<T>(key: string, value: T): Promise<void> {
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }

    this.cache.set(key, {
      data: value,
      timestamp: Date.now()
    });
  }

  async get<T>(key: string): Promise<T | null> {
    const entry = this.cache.get(key);
    
    if (!entry) return null;
    
    if (Date.now() - entry.timestamp > this.ttl) {
      this.cache.delete(key);
      return null;
    }
    
    return entry.data as T;
  }

  async has(key: string): Promise<boolean> {
    return (await this.get<unknown>(key)) !== null;
  }

  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > this.ttl) {
        this.cache.delete(key);
      }
    }
  }

  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
  }
  
  getStats() {
    return {
      type: 'InMemory',
      size: this.cache.size,
      keys: Array.from(this.cache.keys())
    };
  }
}

export class RedisCache implements CacheStore {
  private client: unknown;
  private ttlSeconds: number;

  constructor(redisUrl: string, ttlMs: number = 21600000) {
    this.client = new Redis(redisUrl, {
      connectTimeout: 5000,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null
    });
    this.ttlSeconds = Math.floor(ttlMs / 1000);
    
    // @ts-expect-error - ioredis package type definitions
    this.client.on('error', (err: Error) => {
      console.error('Redis Error:', err);
    });
  }

  async isConnected(): Promise<boolean> {
    try {
      // @ts-expect-error - ioredis package type definitions
      await this.client.ping();
      return true;
    } catch {
      return false;
    }
  }

  async set<T>(key: string, value: T): Promise<void> {
    try {
      const data = JSON.stringify(value);
      // @ts-expect-error - ioredis package type definitions
      await this.client.set(key, data, 'EX', this.ttlSeconds);
    } catch (e) {
      console.error(`Redis set failed for ${key}:`, e);
    }
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      // @ts-expect-error - ioredis package type definitions
      const data = await this.client.get(key);
      if (!data) return null;
      try {
        return JSON.parse(data) as T;
      } catch (e) {
        console.warn(`Failed to parse cache entry for ${key}`, e);
        return null;
      }
    } catch (e) {
      console.error(`Redis get failed for ${key}:`, e);
      return null;
    }
  }

  async has(key: string): Promise<boolean> {
    try {
      // @ts-expect-error - ioredis package type definitions
      return (await this.client.exists(key)) === 1;
    } catch (e) {
      console.error(`Redis exists failed for ${key}:`, e);
      return false;
    }
  }

  destroy(): void {
    // @ts-expect-error - ioredis package type definitions
    this.client.disconnect();
  }
}

const createCache = (): CacheStore => {
  const redisUrl = process.env.REDIS_URL || process.env.REDISCLOUD_URL;
  if (redisUrl) {
    console.log('[CACHE] Attempting Redis connection...');
    const cache = new RedisCache(redisUrl);
    cache.isConnected().then(connected => {
      if (connected) {
        console.log('[CACHE] Using Redis');
      } else {
        console.warn('[CACHE] Redis connection failed, operations may fail');
      }
    }).catch(() => {
      console.warn('[CACHE] Redis health check failed, operations may fail');
    });
    return cache;
  }
  console.log('[CACHE] Using InMemoryCache');
  return new InMemoryCache();
};

export const playerCache = createCache();
