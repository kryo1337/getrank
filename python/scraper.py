import argparse
import asyncio
import aiohttp
import json
import logging
from typing import Dict, Optional

logging.basicConfig(level=logging.ERROR, format="%(message)s")
logger = logging.getLogger(__name__)

API_BASE_URL = "https://api.tracker.gg/api/v2/valorant/standard/profile/riot/"


class TrackerScraper:
    def __init__(self):
        self.ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        self.headers = {
            "Accept": "application/json, text/plain, */*",
            "Accept-Language": "en-US,en;q=0.9",
            "Referer": "https://tracker.gg/",
            "Origin": "https://tracker.gg",
            "DNT": "1",
            "Connection": "keep-alive",
            "Sec-Fetch-Dest": "empty",
            "Sec-Fetch-Mode": "cors",
            "Sec-Fetch-Site": "same-site",
            "User-Agent": self.ua,
        }

    async def get_player_stats(self, handle: str) -> Optional[Dict]:
        encoded_handle = handle.replace("#", "%23")
        url = f"{API_BASE_URL}{encoded_handle}"

        timeout = aiohttp.ClientTimeout(total=10)

        async with aiohttp.ClientSession() as session:
            try:
                async with session.get(
                    url, headers=self.headers, timeout=timeout
                ) as response:
                    if response.status != 200:
                        logger.error(
                            f"Error {response.status}: {await response.text()}"
                        )
                        return None

                    data = await response.json()
                    return self._parse_profile(data, handle)
            except Exception as e:
                logger.error(f"Request failed: {str(e)}")
                return None

    def _parse_profile(self, data: Dict, handle: str) -> Optional[Dict]:
        try:
            if "data" not in data:
                return None

            profile_data = data["data"]
            segments = profile_data.get("segments", [])

            comp_stats = None

            comp_stats = next(
                (
                    s
                    for s in segments
                    if s.get("type") == "season"
                    and s.get("metadata", {}).get("isCurrentSeason")
                ),
                None,
            )

            if not comp_stats:
                comp_stats = next(
                    (
                        s
                        for s in segments
                        if s.get("metadata", {}).get("name") == "Competitive"
                    ),
                    None,
                )

            if not comp_stats:
                comp_stats = next(
                    (
                        s
                        for s in segments
                        if s.get("attributes", {}).get("playlistId") == "competitive"
                    ),
                    None,
                )

            if not comp_stats:
                comp_stats = next(
                    (
                        s
                        for s in segments
                        if "competitive"
                        in str(s.get("metadata", {}).get("name", "")).lower()
                    ),
                    None,
                )

            if not comp_stats:
                return None

            stats = comp_stats.get("stats", {})

            rank = "Unknown"
            if stats.get("rank") and stats["rank"].get("metadata"):
                tier = stats["rank"]["metadata"]["tierName"]
                rr = stats["rank"]["value"]
                rank = f"{tier} {rr}RR"
            elif stats.get("tier"):
                rank = stats["tier"]["displayValue"]

            return {
                "riot_id": handle,
                "current_rank": rank,
                "kd": f"{(stats.get('kDRatio') or {}).get('value', 0):.2f}",
                "wr": f"{(stats.get('matchesWinPct') or {}).get('value', 0):.1f}%",
                "wins": int((stats.get("matchesWon") or {}).get("value", 0)),
                "games_played": int((stats.get("matchesPlayed") or {}).get("value", 0)),
                "tracker_url": f"https://tracker.gg/valorant/profile/riot/{handle.replace('#', '%23')}/overview",
            }

        except Exception as e:
            logger.error(f"Parsing error: {str(e)}")
            return None


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("handle", help="Riot ID (Name#Tag)")
    args = parser.parse_args()

    scraper = TrackerScraper()
    result = await scraper.get_player_stats(args.handle)

    if result:
        print(json.dumps(result))
    else:
        print(json.dumps({"error": "Failed to fetch stats"}))


if __name__ == "__main__":
    asyncio.run(main())
