FROM node:22-bookworm-slim
WORKDIR /app
RUN corepack enable
COPY package.json ./
RUN npm install --omit=dev=false
COPY . .
RUN npx vite build --config web/vite.config.ts
ENV WHARF_HOST=0.0.0.0
ENV WHARF_PORT=8787
ENV WHARF_COMPUTER_PROVIDER=docker
EXPOSE 8787
CMD ["node", "--experimental-sqlite", "--import", "tsx", "src/index.ts"]
