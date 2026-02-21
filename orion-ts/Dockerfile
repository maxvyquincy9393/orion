FROM node:22-alpine

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN npm install -g pnpm && pnpm install --prod

COPY prisma ./prisma
RUN npx prisma generate

COPY dist ./dist

EXPOSE 18789 8080

ENV DATABASE_URL=file:/data/orion.db
VOLUME ["/data"]

CMD ["node", "dist/main.js", "--mode", "gateway"]
