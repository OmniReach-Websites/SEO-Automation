FROM node:24.21.0-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 AS source

ENV NODE_ENV=production
WORKDIR /opt/omnireach

COPY . .
RUN apt-get update \
  && apt-get install --yes --no-install-recommends ca-certificates openssl \
  && rm -rf /var/lib/apt/lists/* \
  && npm ci \
  && npm run build --workspace @omnireach/site-coops-mobile-detailing \
  && npm run build --workspace @omnireach/site-omnireach \
  && npm run db:generate \
  && chmod 0555 \
    infrastructure/compose/scripts/migrate-entrypoint.sh \
    infrastructure/compose/scripts/runtime-entrypoint.sh

FROM source AS migrator

RUN apt-get update \
  && apt-get install --yes --no-install-recommends postgresql-client \
  && rm -rf /var/lib/apt/lists/*

ENTRYPOINT ["/opt/omnireach/infrastructure/compose/scripts/migrate-entrypoint.sh"]

FROM source AS runtime

RUN npm prune --omit=dev --ignore-scripts

USER node
ENTRYPOINT ["/opt/omnireach/infrastructure/compose/scripts/runtime-entrypoint.sh"]
CMD ["node", "--experimental-transform-types", "apps/api/src/main.ts"]
