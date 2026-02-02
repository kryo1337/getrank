import type { PlayerStats, Region } from '../types/index.js';
import * as cheerio from 'cheerio';
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

async function fetchHtmlWithPuppeteer(url: string): Promise<{ html: string; initialState: any; isPrivate?: boolean; isNotFound?: boolean }> {
  const cluster = await getCluster();

  // @ts-ignore
  return cluster.execute(url, async ({ page, data: targetUrl }) => {
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const resourceType = request.resourceType();
      const requestUrl = request.url();
      const blockedDomains = [
        'doubleclick.net',
        'amazon-adsystem.com',
        'google-analytics.com',
        'googletagmanager.com',
        'sentry.io'
      ];

      if (['image', 'media', 'font'].includes(resourceType) ||
        blockedDomains.some(domain => requestUrl.includes(domain))) {
        request.abort();
      } else {
        request.continue();
      }
    });

    await page.setViewport({ width: 1920, height: 1080 });

    const userAgents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
    ];
    const selectedUA = userAgents[Math.floor(Math.random() * userAgents.length)];
    await page.setUserAgent(selectedUA);

    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Upgrade-Insecure-Requests': '1',
    });

    try {
      const response = await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      const status = response?.status();

      if (status === 403 || status === 429) {
        throw new Error(`HTTP ${status} - Blocked`);
      }

      let title = await page.title();

      if (title.includes("Just a moment") || title.includes("Security Challenge")) {
        try {
          await page.waitForFunction(() => {
            const t = document.title;
            return !t.includes("Just a moment") && !t.includes("Security Challenge");
          }, { timeout: 15000 });
        } catch {
          // Proceed anyway
        }
      }

      const isPrivate = await page.evaluate(() => {
        return !!document.querySelector('.private-profile, .profile-private, [src*="private"]');
      });

      if (isPrivate) {
        return { html: '', initialState: null, isPrivate: true };
      }

      const isNotFound = await page.evaluate(() => {
        const content = document.body.innerText;
        return content.includes("Player not found") || (content.includes("404") && !document.querySelector('.profile-header, .giant-stats, .rating-entry__rank-info'));
      });

      if (isNotFound) {
        return { html: '', initialState: null, isNotFound: true };
      }

      try {
        await page.waitForFunction(() => {
          // @ts-ignore
          if (window.__INITIAL_STATE__) return true;
          return document.querySelector('.giant-stats, .rating-entry__rank-info, .stat');
        }, { timeout: 10000 });
      } catch {
        // Proceed anyway
      }

      const initialState = await page.evaluate(() => {
        // @ts-ignore
        return window.__INITIAL_STATE__ || null;
      });

      const content = await page.content();
      return { html: content, initialState };

    } catch (e) {
      console.error('[SCRAPER] Page navigation error:', e);
      throw e;
    }
  });
}

export async function getLeaderboardPage(page: number, region: Region): Promise<any[] | null> {
  const regionParam = REGION_MAP[region];
  const url = `https://tracker.gg/valorant/leaderboards/ranked/all/default?platform=pc&region=${regionParam}&act=${ACT_ID}&page=${page}`;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const { html, initialState } = await fetchHtmlWithPuppeteer(url);

      if (initialState) {
        const leaderboards = initialState?.stats?.standardLeaderboards;
        if (Array.isArray(leaderboards) && leaderboards.length > 0) {
          return leaderboards[0].items;
        }
      }

      const $ = cheerio.load(html);
      const items: any[] = [];

      $('tbody tr').each((_i, element) => {
        const rankCell = $(element).find('td').first();
        const rawText = rankCell.text();
        const rankText = rawText.trim().replace(/[^0-9]/g, '');
        const rank = parseInt(rankText);

        const link = $(element).find('a[href*="/valorant/profile/riot/"]').attr('href');
        let riotId = null;
        if (link) {
          const match = link.match(/\/valorant\/profile\/riot\/([^/]+)\/overview/);
          if (match && match[1]) {
            riotId = decodeURIComponent(match[1]);
          }
        }

        if (rank && riotId) {
          items.push({
            rank: rank,
            owner: {
              metadata: {
                platformUserHandle: riotId
              }
            }
          });
        }
      });

      return items.length > 0 ? items : null;

    } catch (e) {
      console.warn(`Failed to fetch leaderboard page ${page} (attempt ${attempt + 1})`, e);
      if (attempt < 2) {
        await new Promise(resolve => setTimeout(resolve, 2000 * (attempt + 1)));
      }
    }
  }

  return null;
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

