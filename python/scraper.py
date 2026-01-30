import sys
import json
from curl_cffi import requests

API_BASE_URL = "https://api.tracker.gg/api/v2/valorant/standard/profile/riot/"


def get_player_stats(handle: str):
    url = f"{API_BASE_URL}{handle.replace('#', '%23')}"
    headers = {
        "Accept": "application/json, text/plain, */*",
        "Referer": "https://tracker.gg/",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    }

    try:
        resp = requests.get(url, headers=headers, impersonate="chrome110", timeout=10)
        if resp.status_code != 200:
            return {"error": f"HTTP {resp.status_code}"}

        data = resp.json().get("data", {})
        segments = data.get("segments", [])

        comp = next((s for s in segments if s.get("type") == "season"), None)
        if not comp:
            comp = next((s for s in segments if s.get("stats", {}).get("rank")), None)

        if not comp:
            return {"error": "No competitive data found"}

        stats = comp.get("stats", {})

        rank = "Unknown"
        if stats.get("rank"):
            meta = stats["rank"].get("metadata", {})
            rank = (
                f"{meta.get('tierName', 'Unknown')} {stats['rank'].get('value', 0)}RR"
            )
        elif stats.get("tier"):
            rank = stats["tier"].get("displayValue", "Unknown")

        return {
            "riot_id": handle,
            "current_rank": rank,
            "kd": f"{(stats.get('kDRatio') or {}).get('value', 0):.2f}",
            "wr": f"{(stats.get('matchesWinPct') or {}).get('value', 0):.1f}%",
            "wins": int((stats.get("matchesWon") or {}).get("value", 0)),
            "games_played": int((stats.get("matchesPlayed") or {}).get("value", 0)),
            "tracker_url": f"https://tracker.gg/valorant/profile/riot/{handle.replace('#', '%23')}/overview",
        }
    except Exception:
        return {"error": "Request failed"}


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if a != "--"]
    if not args:
        print(json.dumps({"error": "No Riot ID provided"}))
    else:
        print(json.dumps(get_player_stats(args[0])))
