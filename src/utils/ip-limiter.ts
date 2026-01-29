const WINDOW_MS = 60 * 1000; // 1 minute
const MAX_REQUESTS = 20;

const ipRequestMap = new Map<string, number[]>();

// Cleanup every 5 minutes to prevent memory leaks
const CLEANUP_INTERVAL = 5 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  const windowStart = now - WINDOW_MS;
  for (const [ip, requests] of ipRequestMap.entries()) {
    const recent = requests.filter(t => t > windowStart);
    if (recent.length === 0) {
      ipRequestMap.delete(ip);
    } else {
      ipRequestMap.set(ip, recent);
    }
  }
}, CLEANUP_INTERVAL);

export function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const windowStart = now - WINDOW_MS;

  let requests = ipRequestMap.get(ip) || [];
  
  // Filter out old requests
  requests = requests.filter(time => time > windowStart);
  
  if (requests.length >= MAX_REQUESTS) {
    ipRequestMap.set(ip, requests);
    return true;
  }

  requests.push(now);
  ipRequestMap.set(ip, requests);
  
  return false;
}
