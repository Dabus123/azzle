FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
ENV XMTP_ENV=production
ENV XMTP_DB_PATH=/data/.xmtp-db
VOLUME ["/data/.xmtp-db"]
CMD ["node", "dist/scripts/start-worker.js"]
