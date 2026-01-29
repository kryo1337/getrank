FROM oven/bun:1

WORKDIR /app

# Install dependencies needed for Puppeteer
RUN apt-get update && apt-get install -y \
    chromium \
    libnss3 \
    libfreetype6 \
    libfreetype6-dev \
    libharfbuzz-bin \
    ca-certificates \
    fonts-freefont-ttf \
    nodejs \
    npm \
    && rm -rf /var/lib/apt/lists/*

# Create a non-root user to run the app
RUN groupadd -r pptruser && useradd -r -g pptruser -G audio,video pptruser \
    && mkdir -p /home/pptruser/Downloads \
    && chown -R pptruser:pptruser /home/pptruser

COPY package.json bun.lock ./
RUN bun install

COPY . .

RUN bun run build

# Transfer ownership of the application directory to the non-root user
RUN chown -R pptruser:pptruser /app

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

EXPOSE 3000

# Switch to the non-root user
USER pptruser

CMD ["bun", "run", "server.ts"]
