FROM oven/bun:1

WORKDIR /app

# Install dependencies needed for Puppeteer and Python scraper
RUN apt-get update && apt-get install -y \
    chromium \
    python3 \
    python3-pip \
    libcurl4 \
    libnss3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    libpangocairo-1.0-0 \
    && rm -rf /var/lib/apt/lists/*

COPY python/requirements.txt ./python/requirements.txt
RUN pip3 install -r ./python/requirements.txt --break-system-packages

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Create a non-root user to run the app
RUN groupadd -r pptruser && useradd -r -g pptruser -G audio,video pptruser \
    && mkdir -p /home/pptruser/Downloads \
    && chown -R pptruser:pptruser /home/pptruser

COPY package.json bun.lock ./
RUN bun install

COPY . .

# RUN bun run build

# Transfer ownership of the application directory to the non-root user
RUN chown -R pptruser:pptruser /app

EXPOSE 3000

# Switch to the non-root user
USER pptruser

CMD ["bun", "run", "server.ts"]
