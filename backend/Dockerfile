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
USER node
EXPOSE 5000
CMD ["node", "dist/main.js"]

# Analysis sandbox image (ADR-0009): `docker build --target repo-host -t
# tessera-repo-host .`. The worker runs it with no network, a read-only root
# filesystem and an unprivileged user; it never receives credentials.
FROM runtime AS repo-host
USER 65534:65534
ENTRYPOINT ["node", "dist/repo-host/main.js"]
