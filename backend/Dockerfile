# syntax=docker/dockerfile:1

FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY nest-cli.json tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
# Transient analysis storage; mounted as a volume by docker-compose.
RUN mkdir -p /app/var/analysis-storage && chown -R node:node /app/var
USER node
EXPOSE 5000
CMD ["node", "dist/main.js"]
