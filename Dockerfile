# Web app image. Built for linux/amd64 and run on ECS Fargate.
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:24-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# The build needs no secrets: every key is read at runtime. The one build-time setting is not a secret:
# "cached" (hourly quotes, the default) or "realtime" (every 15 seconds).
ARG NEXT_PUBLIC_OPENSTOCK_DATA_MODE=realtime
ENV NEXT_PUBLIC_OPENSTOCK_DATA_MODE=$NEXT_PUBLIC_OPENSTOCK_DATA_MODE
ENV NEXT_TELEMETRY_DISABLED=1
# The provider cache may be absent on a fresh clone; the folder must exist for the copy below
RUN mkdir -p .data/cache && npm run build

FROM node:24-alpine AS run
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN addgroup -S app && adduser -S app -G app
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY --from=build /app/rules ./rules
COPY --from=build /app/data ./data
# Writable folder for the provider cache and the small app-state file (rules, layout).
# The cache built on the deploying machine (scripts/refresh-signals.mjs) is carried in, with each value's
# own fetch time, so the first watchlist of the day does not wait minutes on the providers.
COPY --from=build /app/.data/cache ./.data/cache
RUN chown -R app:app /app/.data
USER app
EXPOSE 3000
CMD ["node", "server.js"]
