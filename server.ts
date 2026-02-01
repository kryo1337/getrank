import { serve } from "bun";
import { handler } from "./api/leaderboard-lookup";
import * as path from "path";
import { initScraper } from "./src/utils/scraper";

initScraper().catch(e => console.error("Failed to init scraper:", e));

const SECURITY_HEADERS = {
  "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self' https://tracker.gg;",
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains"
};

function addHeaders(response: Response): Response {
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    response.headers.set(key, value);
  }
  return response;
}

// Bun server
const server = serve({
  port: 3000,
  async fetch(req) {
    const url = new URL(req.url);
    const pathname = url.pathname.replace(/\/$/, "");

    const clientIP = server.requestIP(req)?.address || "unknown";

    // API Routes
    if (pathname === "/api/leaderboard-lookup") {
      try {
        const response = await handler(req, clientIP);
        return addHeaders(response);
      } catch (e) {
        console.error("Handler error:", e);
        return addHeaders(new Response(JSON.stringify({ error: "Internal Server Error" }), { status: 500 }));
      }
    }

    // Serve static frontend files (after build)
    const distDir = path.resolve("dist");

    let requestedPath = path.join(distDir, url.pathname === "/" ? "index.html" : url.pathname);
    requestedPath = path.resolve(requestedPath);

    // Security Check: Ensure path is within distDir
    if (!requestedPath.startsWith(distDir)) {
      return addHeaders(new Response("403 Forbidden", { status: 403 }));
    }

    const file = Bun.file(requestedPath);
    if (await file.exists()) {
      return addHeaders(new Response(file));
    }

    // Fallback to index.html for client-side routing
    const index = Bun.file(path.join(distDir, "index.html"));
    if (await index.exists()) {
      return addHeaders(new Response(index));
    }

    return addHeaders(new Response("Not Found. Did you run 'bun run build'?", { status: 404 }));
  },
});

console.log("Server running on http://localhost:3000");
