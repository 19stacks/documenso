###########################
#     BASE CONTAINER      #
###########################
FROM node:22-alpine AS base

###########################
#    BUILDER CONTAINER    #
###########################
FROM base AS builder

RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY . .

RUN npm install -g "turbo@^1.13.4"

# Outputs to /app/out — only @documenso/remix and the workspace packages it
# actually depends on (drops apps/docs, apps/openpage-api and their deps,
# e.g. next.js, mermaid, which were bloating the final image).
RUN turbo prune --scope=@documenso/remix --docker

###########################
#   INSTALLER CONTAINER   #
###########################
FROM base AS installer

RUN apk add --no-cache libc6-compat bash python3 make g++
WORKDIR /app

ENV HUSKY=0
# Playwright (@playwright/test) is a devDependency used only for e2e tests.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

RUN npm install -g npm@11.11.0

# Install deps first (change less often) using the pruned package.json/lock.
COPY --from=builder /app/out/json/ .
COPY --from=builder /app/out/package-lock.json ./package-lock.json
# patch-package (postinstall) needs this present before `npm ci` runs.
COPY --from=builder /app/patches ./patches
COPY --from=builder /app/lingui.config.ts ./lingui.config.ts

RUN npm ci

# Layer in the pruned source on top (changes more often).
COPY --from=builder /app/out/full/ .
COPY turbo.json turbo.json

# turbo prune only follows the npm dependency graph, but the translation
# extraction step (lingui) statically scans packages/email's source for
# translatable strings without importing it, so it isn't in the pruned
# output — add it back manually.
COPY --from=builder /app/packages/email ./packages/email

RUN npm install -g "turbo@^1.13.4"

# --memory=4g --memory-swap=4g) — raise it if you deploy to a bigger box.
ENV NODE_OPTIONS="--max-old-space-size=3072"

# `turbo run build` follows turbo.json's pipeline, so packages/prisma's own
# "prebuild" (prisma generate) runs automatically before remix is built —
# no DB access needed for this, only the schema is read.
RUN turbo run build --filter=@documenso/remix...

###########################
#     RUNNER CONTAINER    #
###########################
FROM base AS runner

# Pin npm to match the version used in the installer stage — the base
# image's bundled npm otherwise mismatches package.json's engines range
# and behaves inconsistently with the pruned lockfile (e.g. silently
# dropping the manually re-added tsx/dotenv-cli packages below).
RUN npm install -g npm@11.11.0

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nodejs
USER nodejs

WORKDIR /app

ENV NODE_ENV=production
ENV HUSKY=0

COPY --from=builder --chown=nodejs:nodejs /app/out/json/ .
COPY --from=builder --chown=nodejs:nodejs /app/patches ./patches

RUN npm ci --omit=dev

# tsx & dotenv-cli are devDependencies (omitted above) but are kept so admin
# scripts can be run manually in the running container, e.g.:
#   npm run with:env -- tsx packages/prisma/scripts/create-wize-admin.ts
# Copied straight from the installer's already-resolved node_modules rather
# than re-installed here: an ad-hoc `npm install <pkg>` against this pruned
# lockfile silently no-ops (interacts badly with .npmrc's min-release-age).
COPY --from=installer --chown=nodejs:nodejs /app/node_modules/tsx ./node_modules/tsx
COPY --from=installer --chown=nodejs:nodejs /app/node_modules/get-tsconfig ./node_modules/get-tsconfig
COPY --from=installer --chown=nodejs:nodejs /app/node_modules/resolve-pkg-maps ./node_modules/resolve-pkg-maps
COPY --from=installer --chown=nodejs:nodejs /app/node_modules/dotenv-cli ./node_modules/dotenv-cli
COPY --from=installer --chown=nodejs:nodejs /app/node_modules/dotenv ./node_modules/dotenv
COPY --from=installer --chown=nodejs:nodejs /app/node_modules/dotenv-expand ./node_modules/dotenv-expand
# `COPY --from` dereferences symlinks copied individually (unlike a whole
# directory), which would flatten these into plain files at the wrong path
# and break their relative sibling imports — recreate the links instead.
RUN ln -s ../tsx/dist/cli.mjs ./node_modules/.bin/tsx \
    && ln -s ../dotenv-cli/cli.js ./node_modules/.bin/dotenv

# Built app output.
COPY --from=installer --chown=nodejs:nodejs /app/apps/remix/build ./apps/remix/build
COPY --from=installer --chown=nodejs:nodejs /app/apps/remix/public ./apps/remix/public

# All packages in the pruned scope (api, assets, auth, ee, lib, prisma,
# tailwind-config, trpc, ui — ~38MB total). The admin script's imports
# reach across several of these (e.g. packages/prisma/seed/users.ts pulls
# in @documenso/lib), so copying only packages/prisma isn't enough; this
# is turbo prune's fixed, bounded scope, not the whole monorepo.
COPY --from=builder --chown=nodejs:nodejs /app/out/full/packages ./packages

# Regenerate the Prisma client fresh in this clean runtime environment.
RUN npx prisma generate --schema ./packages/prisma/schema.prisma

# Runs `prisma migrate deploy` then starts the server — moved out of the
# build so the build no longer needs live DB credentials.
COPY --chown=nodejs:nodejs ./docker/start.sh /app/apps/remix/start.sh

EXPOSE 3020

WORKDIR /app/apps/remix

CMD ["sh", "start.sh"]
