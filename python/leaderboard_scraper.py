import sys
import json
import argparse
import re
import urllib.parse
import asyncio
from typing import Literal, Optional
from playwright.async_api import async_playwright, Browser, BrowserContext, Page


ACT_ID = "4c4b8cff-43eb-13d3-8f14-96b783c90cd2"
AllowedRegion = Literal["na", "eu", "ap", "kr", "br", "latam"]
ALLOWED_REGIONS: tuple[AllowedRegion, ...] = ("na", "eu", "ap", "kr", "br", "latam")

_playwright = None
_browser: Optional[Browser] = None
_context: Optional[BrowserContext] = None
_pending_scrapes = set()


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


def get_browser_args():
    return [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-blink-features=AutomationControlled",
        "--disable-features=IsolateOrigins,site-per-process",
        "--disable-web-security",
        "--disable-features=VizDisplayCompositor",
    ]


def get_user_agent():
    return "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"


def get_extra_headers():
    return {
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        "DNT": "1",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
    }


async def reset_browser():
    global _playwright, _browser, _context

    try:
        if _context:
            await _context.close()
    except Exception:
        pass

    _context = None

    try:
        if _browser:
            await _browser.close()
    except Exception:
        pass

    _browser = None

    try:
        if _playwright:
            await _playwright.stop()
    except Exception:
        pass

    _playwright = None

    print("[LEADERBOARD] Browser reset complete", file=sys.stderr)


async def check_browser_health() -> bool:
    try:
        if _playwright is None or _browser is None or _context is None:
            return False

        if not _browser.is_connected():
            return False

        test_page = await _context.new_page()
        await test_page.goto("about:blank", timeout=5000)
        await test_page.close()
        return True
    except Exception as e:
        print(f"[LEADERBOARD] Browser health check failed: {e}", file=sys.stderr)
        return False


async def get_browser_context():
    global _playwright, _browser, _context

    if _playwright is None:
        _playwright = await async_playwright().start()

    if _browser is None:
        _browser = await _playwright.chromium.launch(
            headless=True, args=get_browser_args()
        )

    if _context is None:
        _context = await _browser.new_context(
            viewport={"width": 1920, "height": 1080},
            user_agent=get_user_agent(),
            locale="en-US",
            timezone_id="America/New_York",
            extra_http_headers=get_extra_headers(),
        )

        await _context.add_init_script("""
            Object.defineProperty(navigator, 'webdriver', { get: () => false });
            Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
            Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
            window.chrome = { runtime: {} };

            const originalQuery = window.navigator.permissions.query;
            window.navigator.permissions.query = (parameters) => (
                parameters.name === 'notifications' ?
                    Promise.resolve({ state: Notification.permission }) :
                    originalQuery(parameters)
            );

            Object.defineProperty(navigator, 'platform', {
                get: () => 'Win32'
            });
        """)

        await _context.route(
            "**/*.{png,jpg,jpeg,gif,svg,ico,woff,woff2,ttf,eot}", block_resources
        )

    return _context


async def block_resources(route):
    resource_type = route.request.resource_type
    if resource_type in ["image", "font", "media"]:
        await route.abort()
    else:
        await route.continue_()


async def parse_initial_state(page_obj: Page):
    try:
        content = await page_obj.content()
        match = re.search(
            r"window\.__INITIAL_STATE__\s*=\s*({.+?});", content, re.DOTALL
        )
        if match:
            json_str = match.group(1)
            decoder = json.JSONDecoder()
            data, idx = decoder.raw_decode(json_str)
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
                        simplified_items.append({"rank": rank, "riotId": riot_id})
                return simplified_items
    except Exception as e:
        print(f"[DEBUG] Failed to parse initial state: {e}", file=sys.stderr)
    return None


async def parse_dom(page_obj: Page, page_num: int):
    try:
        rows = await page_obj.locator("tr").all()
        items = []

        for i, row in enumerate(rows):
            try:
                link = row.locator('a[href*="/valorant/profile/"]').first
                if await link.count() > 0:
                    href = await link.get_attribute("href")
                    if href:
                        match = re.search(r"/valorant/profile/riot/([^/]+)", href)
                        if match:
                            riot_id = urllib.parse.unquote(match.group(1))

                            rank_cell = row.locator("td").first
                            rank_text = await rank_cell.text_content()
                            rank_match = (
                                re.search(r"\d+", rank_text) if rank_text else None
                            )
                            rank = int(rank_match.group(0)) if rank_match else 0

                            if rank > 0:
                                items.append({"rank": rank, "riotId": riot_id})
            except Exception:
                continue
        return items if items else None
    except Exception as e:
        print(f"[DEBUG] Failed to parse DOM: {e}", file=sys.stderr)
        return None


async def get_leaderboard(region: str, page_num: int, act_id: str = ACT_ID):
    validated_region = validate_region(region)
    validated_act_id = validate_act_id(act_id)

    if not isinstance(page_num, int) or page_num < 1 or page_num > 10000:
        return {"error": "Invalid page number"}

    cache_key = f"{region}:{page_num}"

    url = f"https://tracker.gg/valorant/leaderboards/ranked/all/default?platform=pc&region={validated_region}&act={validated_act_id}&page={page_num}"

    if cache_key in _pending_scrapes:
        print(
            f"[LEADERBOARD] Already scraping {cache_key}, skipping...", file=sys.stderr
        )
        return {"error": "Service temporarily unavailable"}

    try:
        print(f"[LEADERBOARD] Fetching page {page_num} for {region}", file=sys.stderr)

        _pending_scrapes.add(cache_key)

        if not await check_browser_health():
            print(
                "[LEADERBOARD] Browser health check failed, resetting...",
                file=sys.stderr,
            )
            await reset_browser()

        context = await get_browser_context()
        page_obj = await context.new_page()

        await page_obj.goto(url, wait_until="domcontentloaded", timeout=20000)

        title = await page_obj.title()
        if "Just a moment" in title or "Attention Required" in title:
            print(
                f"[LEADERBOARD] Cloudflare challenge detected, waiting...",
                file=sys.stderr,
            )
            await page_obj.wait_for_timeout(2000)

        items = await parse_initial_state(page_obj)

        if not items:
            print(f"[LEADERBOARD] Trying DOM fallback...", file=sys.stderr)
            items = await parse_dom(page_obj, page_num)

        await page_obj.close()

        if items and len(items) > 0:
            print(f"[LEADERBOARD] Success: found {len(items)} players", file=sys.stderr)
            return {"items": items}
        else:
            return {"error": "Service temporarily unavailable"}

    except Exception as e:
        print(f"[LEADERBOARD] Error: {e}", file=sys.stderr)
        return {"error": "Service temporarily unavailable"}

    finally:
        _pending_scrapes.discard(cache_key)


async def warmup():
    """Initialize browser on server startup to avoid first-request latency."""
    print("[LEADERBOARD] Warming up browser...", file=sys.stderr)
    try:
        await get_browser_context()

        if await check_browser_health():
            print("[LEADERBOARD] Browser warmed up and ready", file=sys.stderr)
        else:
            print(
                "[LEADERBOARD] Browser health check failed during warmup",
                file=sys.stderr,
            )
            await reset_browser()
            await get_browser_context()

            if await check_browser_health():
                print(
                    "[LEADERBOARD] Browser warmed up and ready after reset",
                    file=sys.stderr,
                )
            else:
                print(
                    "[LEADERBOARD] Warmup failed: Browser health check still failing",
                    file=sys.stderr,
                )
    except Exception as e:
        print(f"[LEADERBOARD] Warmup failed: {e}", file=sys.stderr)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Valorant leaderboard scraper with Playwright"
    )
    parser.add_argument("region", type=str, help="Server region")
    parser.add_argument("page", type=int, help="Page number")
    parser.add_argument(
        "act_id", type=str, nargs="?", default=ACT_ID, help="Valorant Act ID"
    )

    args = parser.parse_args()

    try:
        result = asyncio.run(get_leaderboard(args.region, args.page, args.act_id))
        print(json.dumps(result))
    except ValueError as e:
        print(f"[LEADERBOARD] Validation error: {str(e)}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"[LEADERBOARD] Internal error: {str(e)}", file=sys.stderr)
        sys.exit(1)
