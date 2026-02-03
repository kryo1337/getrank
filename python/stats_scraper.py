import sys
import json
import urllib.parse
import re
import argparse
import time
from typing import Literal
from curl_cffi import requests
from playwright.sync_api import sync_playwright

API_BASE_URL = "https://api.tracker.gg/api/v2/valorant/standard/profile/riot/"

AllowedRegion = Literal["na", "eu", "ap", "kr", "br", "latam"]
ALLOWED_REGIONS: tuple[AllowedRegion, ...] = ("na", "eu", "ap", "kr", "br", "latam")

BROWSER_CONFIGS = [
    {
        "impersonate": "chrome124",
        "user_agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "timeout": 12,
    },
    {
        "impersonate": "chrome120",
        "user_agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "timeout": 12,
    },
    {
        "impersonate": "chrome110",
        "user_agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36",
        "timeout": 12,
    },
]


def validate_region(region: str) -> AllowedRegion:
    region = region.lower().strip()
    if region not in ALLOWED_REGIONS:
        raise ValueError(f"Invalid region: {region}")
    return region


def validate_act_id(act_id: str) -> str:
    uuid_pattern = re.compile(
        r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.IGNORECASE
    )
    if not uuid_pattern.match(act_id):
        raise ValueError(f"Invalid act_id format")
    return act_id


def validate_handle(handle: str) -> bool:
    if "#" not in handle:
        return False

    parts = handle.split("#")
    if len(parts) != 2:
        return False

    name, tag = parts

    if len(name) < 3 or len(name) > 20:
        return False

    if len(tag) < 3 or len(tag) > 5:
        return False

    if len(handle) > 100:
        return False

    return True


def get_player_stats(handle: str):
    url = f"{API_BASE_URL}{urllib.parse.quote(handle)}"

    for attempt, browser_config in enumerate(BROWSER_CONFIGS, 1):
        headers = {
            "Accept": "application/json, text/plain, */*",
            "Accept-Language": "en-US,en;q=0.9",
            "Referer": "https://tracker.gg/",
            "User-Agent": browser_config["user_agent"],
        }

        try:
            print(
                f"[STATS] Attempt {attempt}/{len(BROWSER_CONFIGS)}: {browser_config['impersonate']} for {handle}",
                file=sys.stderr,
            )

            resp = requests.get(
                url,
                headers=headers,
                impersonate=browser_config["impersonate"],
                timeout=browser_config["timeout"],
            )

            if resp.status_code == 404:
                print(f"[STATS] Player not found for {handle}", file=sys.stderr)
                return {"error": "Service temporarily unavailable"}

            if resp.status_code != 200:
                print(
                    f"[STATS] Attempt {attempt} failed: HTTP {resp.status_code}",
                    file=sys.stderr,
                )
                if attempt < len(BROWSER_CONFIGS):
                    time.sleep(1)
                    continue
                return {"error": "Service temporarily unavailable"}

            data = resp.json().get("data", {})
            if not data:
                print(f"[STATS] No data found for {handle}", file=sys.stderr)
                return {"error": "Service temporarily unavailable"}

            segments = data.get("segments", [])

            comp = next((s for s in segments if s.get("type") == "season"), None)
            if not comp:
                comp = next(
                    (s for s in segments if s.get("stats", {}).get("rank")), None
                )

            if not comp:
                print(f"[STATS] No competitive data for {handle}", file=sys.stderr)
                return {"error": "Service temporarily unavailable"}

            stats = comp.get("stats", {})

            rank = "Unknown"
            if stats.get("rank"):
                meta = stats["rank"].get("metadata", {})
                rank = f"{meta.get('tierName', 'Unknown')} {stats['rank'].get('value', 0)}RR"
            elif stats.get("tier"):
                rank = stats["tier"].get("displayValue", "Unknown")

            print(f"[STATS] Success on attempt {attempt} for {handle}", file=sys.stderr)

            return {
                "riot_id": handle,
                "current_rank": rank,
                "kd": f"{(stats.get('kDRatio') or {}).get('value', 0):.2f}",
                "wr": f"{(stats.get('matchesWinPct') or {}).get('value', 0):.1f}%",
                "wins": int((stats.get("matchesWon") or {}).get("value", 0)),
                "games_played": int((stats.get("matchesPlayed") or {}).get("value", 0)),
                "tracker_url": f"https://tracker.gg/valorant/profile/riot/{urllib.parse.quote(handle)}/overview",
            }

        except Exception as e:
            print(f"[STATS] Attempt {attempt} exception: {str(e)}", file=sys.stderr)
            if attempt < len(BROWSER_CONFIGS):
                time.sleep(1)
                continue
            return {"error": "Service temporarily unavailable"}

    return {"error": "Service temporarily unavailable"}


def get_leaderboard(region: str, page: int, act_id: str):
    validated_region = validate_region(region)
    validated_act_id = validate_act_id(act_id)

    if not isinstance(page, int) or page < 1 or page > 10000:
        return {"error": "Invalid page number"}

    base_url = "https://tracker.gg/valorant/leaderboards/ranked/all/default"
    url = f"{base_url}?platform=pc&region={validated_region}&act={validated_act_id}&page={page}"

    if not url.startswith("https://tracker.gg/valorant/leaderboards/"):
        return {"error": "Invalid URL constructed"}

    headers = {
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": "https://tracker.gg/",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    }

    try:
        resp = requests.get(url, headers=headers, impersonate="chrome120", timeout=15)

        if resp.status_code != 200:
            print(f"[STATS] Status: {resp.status_code}, URL: {url}", file=sys.stderr)
            return {"error": "Service temporarily unavailable"}

        html = resp.text

        initial_state_start = html.find("window.__INITIAL_STATE__")
        if initial_state_start != -1:
            try:
                json_start = html.find("{", initial_state_start)
                if json_start != -1:
                    data, _ = json.JSONDecoder().raw_decode(html[json_start:])

                    leaderboards = data.get("stats", {}).get("standardLeaderboards", [])
                    if leaderboards:
                        raw_items = leaderboards[0].get("items", [])
                        simplified_items = []
                        for item in raw_items:
                            rank = item.get("rank")
                            owner = item.get("owner", {})
                            metadata = owner.get("metadata", {})
                            riot_id = (
                                metadata.get("platformUserHandle")
                                or metadata.get("platformUserIdentifier")
                                or owner.get("id")
                            )

                            if rank and riot_id:
                                simplified_items.append(
                                    {"rank": rank, "riotId": riot_id}
                                )
                        return {"items": simplified_items}
            except Exception:
                pass

        items = []
        rows = re.split(r"<tr\s*", html)

        current_rank_base = (int(page) - 1) * 100

        for i, row in enumerate(rows[1:]):
            link_match = re.search(r'/valorant/profile/riot/([^/"]+)/overview', row)
            if link_match:
                riot_id = urllib.parse.unquote(link_match.group(1))

                rank = 0
                rank_match = re.search(r"<td[^>]*>.*?(\d+).*?</td>", row, re.DOTALL)
                if rank_match:
                    rank = int(rank_match.group(1))
                else:
                    rank = current_rank_base + i + 1

                items.append({"rank": rank, "riotId": riot_id})

        if len(items) > 0:
            return {"items": items}

        return {"error": "Service temporarily unavailable"}

    except Exception as e:
        print(f"[STATS] Error: {str(e)}", file=sys.stderr)
        return {"error": "Service temporarily unavailable"}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Valorant player stats scraper")
    subparsers = parser.add_subparsers(dest="command", required=True)

    profile_parser = subparsers.add_parser("profile", help="Get player stats")
    profile_parser.add_argument(
        "handle", type=str, help="Player Riot ID (e.g., name#tag)"
    )

    leaderboard_parser = subparsers.add_parser(
        "leaderboard", help="Get leaderboard data"
    )
    leaderboard_parser.add_argument("region", type=str, help="Server region")
    leaderboard_parser.add_argument("page", type=int, help="Page number")
    leaderboard_parser.add_argument("act_id", type=str, help="Valorant Act ID")

    args = parser.parse_args()

    try:
        if args.command == "profile":
            if not validate_handle(args.handle):
                print(f"[STATS] Invalid Riot ID format: {args.handle}", file=sys.stderr)
                sys.exit(1)
            result = get_player_stats(args.handle)
            print(json.dumps(result))

        elif args.command == "leaderboard":
            if args.page < 1 or args.page > 10000:
                print(f"[STATS] Page number out of range: {args.page}", file=sys.stderr)
                sys.exit(1)

            result = get_leaderboard(args.region, args.page, args.act_id)
            print(json.dumps(result))

    except ValueError as e:
        print(f"[STATS] Validation error: {str(e)}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"[STATS] Internal error: {str(e)}", file=sys.stderr)
        sys.exit(1)
