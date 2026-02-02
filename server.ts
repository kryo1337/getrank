import { serve } from "bun";
import { handler as lookupHandler } from "./api/leaderboard-lookup";
import * as path from "path";

const SECURITY_HEADERS = {
  "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self' https://tracker.gg; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains; preload",
  "Permissions-Policy": "geolocation=(), microphone=(), camera=(), payment=()"
};

function addHeaders(response: Response): Response {
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    response.headers.set(key, value);
  }
  return response;
}

const server = serve({
  port: 3000,
  async fetch(req) {
    const url = new URL(req.url);
    const pathname = url.pathname.replace(/\/$/, "");

    const clientIP = server.requestIP(req)?.address || "unknown";

    if (pathname === "/api/leaderboard-lookup") {
      try {
        const response = await lookupHandler(req, clientIP);
        return addHeaders(response);
      } catch (e) {
        console.error("Handler error:", e);
        return addHeaders(new Response(JSON.stringify({ error: "Internal Server Error" }), { status: 500 }));
      }
    }

    const distDir = path.resolve("dist");

    let requestedPath = path.join(distDir, url.pathname === "/" ? "index.html" : url.pathname);
    requestedPath = path.resolve(requestedPath);

    if (!requestedPath.startsWith(distDir)) {
      return addHeaders(new Response("403 Forbidden", { status: 403 }));
    }

    const file = Bun.file(requestedPath);
    if (await file.exists()) {
      return addHeaders(new Response(file));
    }

    const index = Bun.file(path.join(distDir, "index.html"));
    if (await index.exists()) {
      return addHeaders(new Response(index));
    }

    return addHeaders(new Response("Not Found. Did you run 'bun run build'?", { status: 404 }));
  },
});

console.log("Server running on http://localhost:3000");
