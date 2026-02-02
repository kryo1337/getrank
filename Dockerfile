FROM oven/bun:1 AS base

WORKDIR /app

FROM base AS python-deps

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    wget \
    gnupg \
    ca-certificates \
    libnss3 \
    libnspr4 \
    libdrm2 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    libatk1.0-0 \
    libatspi2.0-0 \
    libcups2 \
    libdbus-1-3 \
    && rm -rf /var/lib/apt/lists/* /tmp/*

COPY python/requirements.txt ./python/requirements.txt
RUN python3 -m pip install --no-cache-dir --break-system-packages -r ./python/requirements.txt
RUN playwright install chromium --with-deps

FROM base AS bun-deps

COPY package.json ./
RUN bun install --frozen-lockfile

FROM base AS final

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    libnss3 \
    libnspr4 \
    libdrm2 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libxkbcommon0 \
    libgbm1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libatspi2.0-0 \
    libcups2 \
    libdbus-1-3 \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/* /tmp/*

WORKDIR /app

COPY --from=python-deps /usr/local /usr/local
COPY --from=python-deps /root/.cache/ms-playwright /root/.cache/ms-playwright
COPY --from=bun-deps /app/node_modules ./node_modules
COPY package.json ./

COPY api/ ./api/
COPY src/utils/ ./src/utils/
COPY src/types/ ./src/types/
COPY python/ ./python/
COPY server.ts ./

EXPOSE 3000

CMD ["bun", "run", "server.ts"]
