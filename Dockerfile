FROM oven/bun:1

WORKDIR /app

RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-venv \
    && rm -rf /var/lib/apt/lists/*

COPY python/requirements.txt ./python/requirements.txt
RUN python3 -m pip install --no-cache-dir --break-system-packages -r ./python/requirements.txt

COPY package.json bun.lock ./
RUN bun install

COPY . .

EXPOSE 3000

CMD ["bun", "run", "server.ts"]
