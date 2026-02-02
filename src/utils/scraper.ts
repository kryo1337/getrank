import type { PlayerStats, Region } from '../types/index.js';
import puppeteer from 'puppeteer-extra';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { Cluster } from 'puppeteer-cluster';

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
puppeteer.use(StealthPlugin());

const ACT_ID = process.env.VALORANT_ACT_ID || '4c4b8cff-43eb-13d3-8f14-96b783c90cd2';

export const REGION_MAP: Record<Region, string> = {
  'na': 'na',
  'eu': 'eu',
  'ap': 'ap',
  'kr': 'kr',
  'br': 'br',
  'latam': 'latam'
};

let clusterPromise: Promise<Cluster> | null = null;

async function getCluster(): Promise<Cluster> {
  if (clusterPromise) return clusterPromise;

  clusterPromise = (async () => {
    try {
      const cluster = await Cluster.launch({
        concurrency: Cluster.CONCURRENCY_CONTEXT,
        maxConcurrency: 5,
        puppeteer: puppeteer,
        puppeteerOptions: {
          headless: true,
          executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu',
            '--window-size=1920,1080',
            '--ignore-certificate-errors'
          ]
        }
      });
      console.log('[SCRAPER] Cluster launched successfully');
      return cluster;
    } catch (e) {
      console.error('[SCRAPER] Failed to launch cluster:', e);
      clusterPromise = null;
      throw e;
    }
  })();

  return clusterPromise;
}

export async function initScraper() {
  const cluster = await getCluster();
  console.log('[SCRAPER] Warming up browser...');
  
  try {
    await cluster.execute('https://tracker.gg/valorant', async ({ page, data: url }) => {
      await page.setRequestInterception(true);
      page.on('request', (req) => {
        if (['image', 'media', 'font'].includes(req.resourceType())) req.abort();
        else req.continue();
      });
      
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
        console.log('[SCRAPER] Browser warmup complete');
      } catch (e) {
        console.warn('[SCRAPER] Warmup navigation failed (non-fatal):', e);
      }
    });
  } catch (e) {
    console.error('[SCRAPER] Warmup failed:', e);
  }
}

const gracefulShutdown = async () => {
  if (clusterPromise) {
    const cluster = await clusterPromise;
    await cluster.close();
    clusterPromise = null;
  }
  process.exit(0);
};

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);
process.on('SIGUSR2', gracefulShutdown);


async function getLeaderboardViaPython(region: string, page: number): Promise<any[] | null> {
  try {
    const proc = Bun.spawn(["python3", "python/scraper.py", "leaderboard", region, page.toString(), ACT_ID], {
      cwd: process.cwd(),
      stderr: "inherit"
    });

    const output = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      console.error(`[PYTHON SCRAPER] Leaderboard process failed with exit code ${exitCode}`);
      return null;
    }

    const data = JSON.parse(output.trim());
    if (data && data.items) {
      console.log(`[PYTHON SCRAPER] Leaderboard success for page ${page}`);
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
      console.warn(`[PYTHON SCRAPER] Leaderboard error: ${data.error}`);
    }
    
    return null;
  } catch (e) {
    console.error(`[PYTHON SCRAPER] Leaderboard failed:`, e);
    return null;
  }
}

export async function getLeaderboardPage(page: number, region: Region): Promise<any[] | null> {
  const regionParam = REGION_MAP[region];
  console.log(`[SCRAPER] Fetching leaderboard page ${page} for ${region} via Python...`);
  return await getLeaderboardViaPython(regionParam, page);
}

export async function getPlayerByRank(rank: number, region: Region): Promise<{ riotId: string } | null> {
  const page = Math.ceil(rank / 100);
  const items = await getLeaderboardPage(page, region);

  if (items) {
    const playerItem = items.find((item: any) => item.rank === rank);
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
  try {
    const proc = Bun.spawn(["python3", "python/scraper.py", "--", riotId], {
      cwd: process.cwd(),
      stderr: "inherit"
    });

    const output = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      console.error(`[PYTHON SCRAPER] Process failed for ${riotId} with exit code ${exitCode}`);
      return null;
    }

    const data = JSON.parse(output.trim());

    if (data && data.error) {
      return { error: data.error };
    }

    if (data && !data.error) {
      console.log(`[PYTHON SCRAPER] Success for ${riotId}`);
      return data;
    }
    return null;
  } catch (e) {
    console.error(`[PYTHON SCRAPER] Failed for ${riotId}:`, e);
    return null;
  }
}

export async function getPlayerStats(riotId: string): Promise<Partial<PlayerStats> | null> {
  const pythonStats = await getPlayerStatsViaPython(riotId);
  
  if (pythonStats) {
    if (pythonStats.error) {
      console.warn(`[PYTHON SCRAPER] Returned error for ${riotId}: ${pythonStats.error}`);
    }
    return pythonStats;
  }
  
  return { error: 'Scraping failed' };
}

