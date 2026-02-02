import RedisPkg from 'ioredis';
// @ts-ignore
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
  getStats?(): any;
}

export class InMemoryCache implements CacheStore {
  private cache: Map<string, CacheEntry<any>>;
  private ttl: number;
  private maxSize: number;
  private cleanupInterval: ReturnType<typeof setInterval>;

  constructor(ttlMs: number = 21600000, maxSize: number = 10000) { // Default 6 hours, 10k items
    this.cache = new Map();
    this.ttl = ttlMs;
    this.maxSize = maxSize;
    
    // Periodic cleanup every 30 minutes
    this.cleanupInterval = setInterval(() => this.cleanup(), 30 * 60 * 1000);
  }

  async set<T>(key: string, value: T): Promise<void> {
    // LRU-like eviction if full
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
    
    return entry.data;
  }

  async has(key: string): Promise<boolean> {
    return (await this.get(key)) !== null;
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
  private client: any;
  private ttlSeconds: number;

  constructor(redisUrl: string, ttlMs: number = 21600000) {
    // @ts-ignore
    this.client = new Redis(redisUrl);
    this.ttlSeconds = Math.floor(ttlMs / 1000);
    
    this.client.on('error', (err: any) => {
      console.error('Redis Error:', err);
    });
  }

  async set<T>(key: string, value: T): Promise<void> {
    const data = JSON.stringify(value);
    await this.client.set(key, data, 'EX', this.ttlSeconds);
  }

  async get<T>(key: string): Promise<T | null> {
    const data = await this.client.get(key);
    if (!data) return null;
    try {
      return JSON.parse(data) as T;
    } catch (e) {
      console.warn(`Failed to parse cache entry for ${key}`, e);
      return null;
    }
  }

  async has(key: string): Promise<boolean> {
    return (await this.client.exists(key)) === 1;
  }

  destroy(): void {
    this.client.disconnect();
  }
}

const createCache = (): CacheStore => {
  if (process.env.REDIS_URL) {
    console.log('Using Redis Cache');
    return new RedisCache(process.env.REDIS_URL);
  }
  console.log('Using In-Memory Cache');
  return new InMemoryCache();
};

export const playerCache = createCache();
