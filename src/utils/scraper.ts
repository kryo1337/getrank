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

const ACT_ID = process.env.VALORANT_ACT_ID || '4c4b8cff-43eb-13d3-8f14-96b783c90cd2'; // Fallback to V25: ACT VI if env not set

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

  clusterPromise = Cluster.launch({
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
  return clusterPromise;
}

// Graceful shutdown handler
const gracefulShutdown = async () => {
  if (clusterPromise) {
    console.log('Closing browser cluster...');
    const cluster = await clusterPromise;
    await cluster.close();
    clusterPromise = null;
  }
  process.exit(0);
};

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);
process.on('SIGUSR2', gracefulShutdown);

async function fetchHtmlWithPuppeteer(url: string): Promise<string> {
  const cluster = await getCluster();
  
  return cluster.execute(url, async ({ page, data: targetUrl }) => {
      await page.setRequestInterception(true);
      page.on('request', (req) => {
        const resourceType = req.resourceType();
        if (['image', 'media'].includes(resourceType)) {
          req.abort();
        } else {
          req.continue();
        }
      });

      await page.setViewport({ width: 1920, height: 1080 });
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
      await page.setExtraHTTPHeaders({
        'Accept-Language': 'en-US,en;q=0.9',
      });

      try {
        console.log(`[SCRAPER] Navigating to: ${targetUrl}`);
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

        const title = await page.title();
        console.log(`[SCRAPER] Page title: ${title}`);

        if (title.includes("Just a moment") || title.includes("Security Challenge")) {
             console.log('[SCRAPER] Cloudflare challenge detected, waiting...');
             await new Promise(r => setTimeout(r, 5000));
        }

        try {
          await page.waitForSelector('.giant-stats, .rating-entry__rank-info, .stat', { timeout: 5000 });
        } catch {
           console.log('[SCRAPER] Selector wait timeout (might be ok if page structure differs)');
        }
      } catch (e) {
          console.error('[SCRAPER] Page navigation error:', e);
          throw e; // Re-throw to ensure the task fails visibly
      }

      return await page.content();
  });
}

function extractInitialState(html: string): any {
  const startMarker = 'window.__INITIAL_STATE__ = ';
  const startIdx = html.indexOf(startMarker);
  
  if (startIdx === -1) {
    return null;
  }
  
  const jsonStart = startIdx + startMarker.length;
  let braceCount = 0;
  let inString = false;
  let escape = false;
  let jsonEnd = -1;
  
  for (let i = jsonStart; i < html.length; i++) {
    const char = html[i];
    
    if (escape) {
      escape = false;
      continue;
    }
    
    if (char === '\\') {
      escape = true;
      continue;
    }
    
    if (char === '"') {
      inString = !inString;
      continue;
    }
    
    if (!inString) {
      if (char === '{') {
        braceCount++;
      } else if (char === '}') {
        braceCount--;
        if (braceCount === 0) {
          jsonEnd = i + 1;
          break;
        }
      }
    }
  }
  
  if (jsonEnd !== -1) {
    try {
      const jsonStr = html.substring(jsonStart, jsonEnd);
      return JSON.parse(jsonStr);
    } catch (e) {
      console.error('Failed to parse INITIAL_STATE JSON', e);
      return null;
    }
  }
  
  return null;
}

export async function getLeaderboardPage(page: number, region: Region): Promise<any[] | null> {
  const regionParam = REGION_MAP[region];
  const url = `https://tracker.gg/valorant/leaderboards/ranked/all/default?platform=pc&region=${regionParam}&act=${ACT_ID}&page=${page}`;
  
  try {
    const html = await fetchHtmlWithPuppeteer(url);
    
    const initialState = extractInitialState(html);
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
    console.warn(`Failed to fetch leaderboard page ${page}`, e);
    return null;
  }
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

export async function getPlayerStats(riotId: string): Promise<Partial<PlayerStats> | null> {
  const encodedId = encodeURIComponent(riotId);
  const profileUrl = `https://tracker.gg/valorant/profile/riot/${encodedId}/overview`;
  
  try {
      const html = await fetchHtmlWithPuppeteer(profileUrl);
      
      const initialState = extractInitialState(html);
      if (initialState) {
          const profiles = initialState?.stats?.standardProfiles;
          
          if (Array.isArray(profiles) && profiles.length > 0) {
              const profile = profiles[0];
              const segments = profile.segments || [];
              
              let competitiveStats = segments.find((s: any) => s.type === "season");
              if (!competitiveStats) {
                   competitiveStats = segments.find((s: any) => s.metadata?.name === 'Competitive') || 
                                      segments.find((s: any) => s.type === 'playlist' && s.attributes?.playlistId === 'competitive');
              }
              
              if (competitiveStats) {
                   const stats = competitiveStats.stats || {};
                   
                   let rank = 'Unknown';
                   if (stats.rank) {
                        const rankMeta = stats.rank.metadata || {};
                        const tierName = rankMeta.tierName || 'Unknown';
                        const rr = stats.rank.value;
                        rank = `${tierName} ${rr}RR`;
                   } else {
                        const rankObj = profile.stats?.find((s: any) => s.metadata?.key === 'Tier');
                        if (rankObj) rank = rankObj.displayValue;
                   }

                   const matches = stats.matchesPlayed?.value || 0;
                   const wins = stats.matchesWon?.value || 0;
                   const winPct = stats.matchesWinPct?.value || 0;
                   const kd = stats.kDRatio?.value || 0;

                   return {
                       riot_id: riotId,
                       current_rank: rank,
                       kd: kd.toFixed(2),
                       wr: `${winPct}%`,
                       wins: wins,
                       games_played: matches,
                       tracker_url: profileUrl
                   };
              }
          }
      }

      const $ = cheerio.load(html);
      
      const getValueByLabel = (label: string): string => {
          const labelEl = $(`.stat .label:contains("${label}"), .giant-stats .label:contains("${label}")`).last();
          
          if (labelEl.length) {
              const val = labelEl.siblings('.value').text().trim() || 
                          labelEl.parent().find('.value').text().trim();
              if (val) return val;
          }

          const anyLabelEl = $(`*:contains("${label}")`).last();
          const val = anyLabelEl.parent().find('.value').text().trim() || 
                      anyLabelEl.next().text().trim();
          
          if (val && val.toLowerCase() !== label.toLowerCase() && val.length < 20) {
              return val;
          }
          return '';
      };
      
      const rankTier = $('.rating-entry__rank-info .label').first().text().trim();
      const rankRR = $('.rating-entry__rank-info .value').first().text().trim();
      const rankFallback = $('.valorant-rank-bg').text().trim();
      
      let rank = 'Unknown';
      if (rankTier && rankRR) {
          rank = `${rankTier} ${rankRR}`;
      } else if (rankFallback) {
          rank = rankFallback;
      }
      
      const matchesStr = $('.matches').first().text().trim(); 
      let matchesVal = parseInt(matchesStr.replace(/[^0-9]/g, '')) || 0;
      
      if (!matchesVal) {
           const m = getValueByLabel('Matches') || getValueByLabel('Games');
           matchesVal = parseInt(m) || 0;
      }
      
      let wrVal = '';
      const winLabel = $('span[title="Win %"]').first();
      if (winLabel.length) {
          wrVal = winLabel.next().find('.value').text().trim() || 
                  winLabel.parent().find('.value').text().trim();
      }
      if (!wrVal) {
          wrVal = getValueByLabel('Win %');
      }

      const kd = getValueByLabel('K/D Ratio');
      const wins = getValueByLabel('Wins'); 
      
      let wrClean = wrVal;
      if (wrClean && !wrClean.includes('%') && !isNaN(parseFloat(wrClean))) {
          wrClean = `${wrClean}%`;
      }

      return {
          riot_id: riotId,
          current_rank: rank,
          kd: kd || 'N/A',
          wr: wrClean || 'N/A',
          wins: parseInt(wins) || 0,
          games_played: matchesVal,
          tracker_url: profileUrl
      };

  } catch (e) {
      console.error(`Scraping failed for ${riotId}`, e);
      return null;
  }
}
