import sys
import json
import time
import urllib.parse
from curl_cffi import requests

API_BASE_URL = "https://api.tracker.gg/api/v2/valorant/standard/profile/riot/"


def get_player_stats(handle: str):
    url = f"{API_BASE_URL}{urllib.parse.quote(handle)}"
    headers = {
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": "https://tracker.gg/",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    }

    for attempt in range(3):
        try:
            resp = requests.get(
                url, headers=headers, impersonate="chrome124", timeout=10
            )
            if resp.status_code == 403 or resp.status_code == 429:
                time.sleep(1 * (attempt + 1))
                continue

            if resp.status_code == 404:
                return {"error": "Player not found"}
            if resp.status_code != 200:
                return {"error": f"HTTP {resp.status_code}"}

            data = resp.json().get("data", {})
            if not data:
                return {"error": "Private Profile or No Data"}

            segments = data.get("segments", [])

            comp = next((s for s in segments if s.get("type") == "season"), None)
            if not comp:
                comp = next(
                    (s for s in segments if s.get("stats", {}).get("rank")), None
                )

            if not comp:
                return {"error": "No competitive data found"}

            stats = comp.get("stats", {})

            rank = "Unknown"
            if stats.get("rank"):
                meta = stats["rank"].get("metadata", {})
                rank = f"{meta.get('tierName', 'Unknown')} {stats['rank'].get('value', 0)}RR"
            elif stats.get("tier"):
                rank = stats["tier"].get("displayValue", "Unknown")

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
            if attempt == 2:
                return {"error": "Request failed"}
            time.sleep(1)

    return {"error": "Request failed after retries"}


def get_leaderboard(region, page, act_id):
    url = f"https://tracker.gg/valorant/leaderboards/ranked/all/default?platform=pc&region={region}&act={act_id}&page={page}"
    headers = {
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": "https://tracker.gg/",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    }

    for attempt in range(3):
        try:
            resp = requests.get(
                url, headers=headers, impersonate="chrome120", timeout=15
            )
            if resp.status_code == 403:
                time.sleep(1 + attempt)
                continue

            if resp.status_code != 200:
                return {"error": f"HTTP {resp.status_code}"}

            html = resp.text

            if "Just a moment" in html or "Security Challenge" in html:
                time.sleep(2 + attempt)
                continue

            import re

            match = re.search(
                r"window\.__INITIAL_STATE__\s*=\s*({.+?});", html, re.DOTALL
            )
            if match:
                try:
                    data = json.loads(match.group(1))
                    leaderboards = data.get("stats", {}).get("standardLeaderboards", [])
                    if leaderboards:
                        return {"items": leaderboards[0].get("items", [])}
                except:
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

                    items.append(
                        {
                            "rank": rank,
                            "owner": {"metadata": {"platformUserHandle": riot_id}},
                        }
                    )

            if len(items) > 0:
                return {"items": items}

            if attempt == 2:
                title_match = re.search(r"<title>(.*?)</title>", html)
                title = title_match.group(1) if title_match else "No Title"
                sys.stderr.write(f"HTML Parsing Failed. Title: {title}\n")
                return {"error": "Could not parse leaderboard data"}

        except Exception as e:
            if attempt == 2:
                return {"error": f"Request failed: {str(e)}"}
            time.sleep(1)

    return {"error": "Request failed after retries"}


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if a != "--"]
    if not args:
        print(json.dumps({"error": "No arguments provided"}))
        sys.exit(1)

    command = args[0]

    if command == "profile" and len(args) >= 2:
        print(json.dumps(get_player_stats(args[1])))
    elif command == "leaderboard" and len(args) >= 4:
        print(json.dumps(get_leaderboard(args[1], args[2], args[3])))
    elif len(args) == 1 and command not in ["profile", "leaderboard"]:
        print(json.dumps(get_player_stats(command)))
    else:
        print(json.dumps({"error": "Invalid arguments"}))
