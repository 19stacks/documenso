# Docker Setup Documentation

This document explains the Docker build (`Dockerfile`) and the two deployment scripts (`deploy/build-and-push.sh` and `deploy/run-on-server.sh`) used to build, publish, and deploy the application.

---

## Overview

The setup has two parts:

1. **Build machine** (local machine or CI): builds the Docker image and pushes it to Docker Hub.
2. **Server**: pulls the image from Docker Hub and runs it as a container.

```
Build machine                         Docker Hub                        Server
--------------                        -----------                       ------
deploy/build-and-push.sh   ------->   imageshub1/documenso   ------->   deploy/run-on-server.sh
(build, test, push)                   (image storage)                  (pull, swap, run)
```

---

## 1. The Dockerfile

The Dockerfile builds the image in **three stages**. Only the last stage becomes the final image — the first two are disposable "workshops" used to prepare things, and everything not explicitly copied out of them is discarded.

### Why three stages?

The project is a monorepo containing multiple apps (`apps/remix`, `apps/docs`, `apps/openpage-api`) that share one `node_modules`. Only `apps/remix` is the actual product that needs to be deployed. A naive build would include dependencies for all three apps, resulting in a much larger image (roughly 2.2 GB) than necessary — most of which (~370 MB) was unused documentation-site tooling (`next.js`, `mermaid`) that `apps/remix` never touches.

The three-stage approach uses a tool called `turbo prune` to compute exactly which packages `apps/remix` depends on, and builds a final image containing only those — reducing the image to roughly 1.4 GB.

### Stage 1 — `builder`: figure out what's actually needed

```dockerfile
FROM base AS builder
COPY . .
RUN npm install -g "turbo@^1.13.4"
RUN turbo prune --scope=@documenso/remix --docker
```

- Copies in the entire monorepo.
- Runs `turbo prune`, which inspects `@documenso/remix`'s dependency graph and writes a trimmed copy of the repo to `/app/out/` — containing only the workspace packages remix actually needs (`packages/lib`, `packages/prisma`, `packages/ui`, etc.), plus a matching, filtered `package-lock.json`.
- `apps/docs` and `apps/openpage-api` are dropped entirely at this step, along with everything they depend on.

### Stage 2 — `installer`: install dependencies and build the app

```dockerfile
COPY --from=builder /app/out/json/ .
COPY --from=builder /app/patches ./patches
RUN npm ci
COPY --from=builder /app/out/full/ .
RUN turbo run build --filter=@documenso/remix...
```

- Copies in just the trimmed `package.json`/lockfile first and runs `npm ci`. This is a caching optimization: this layer only needs to re-run when dependencies change, not on every source code edit.
- Copies in the real source code and builds the app with `turbo run build`, which also automatically runs `packages/prisma`'s Prisma Client generation step first (via the pipeline defined in `turbo.json`) — no database connection is needed for this, only the schema file is read.
- Two things are added back manually here because `turbo prune` doesn't know about them (they aren't tracked as npm dependencies):
  - `patches/` — the project uses `patch-package` to fix a bug in a third-party package; this must be present before `npm ci` runs.
  - `lingui.config.ts` and `packages/email` — the translation-extraction step scans `packages/email`'s source code as plain text (not as an import), so `turbo prune` doesn't detect this as a dependency.
- Output of this stage: the compiled application in `apps/remix/build/`.

### Stage 3 — `runner`: the lean image that actually ships

```dockerfile
COPY --from=builder /app/out/json/ .
RUN npm ci --omit=dev
```

This is the only stage that becomes the final image. It starts fresh and copies in only the finished pieces:

- A **production-only** dependency install (`--omit=dev`), using the trimmed lockfile — this is what actually shrinks `node_modules` (from ~2.0 GB down to ~1.2 GB), since development tools (test runners, linters, the TypeScript compiler, etc.) are excluded.
- The compiled app (`apps/remix/build`, `apps/remix/public`).
- The source of all workspace packages in the trimmed scope (`api`, `assets`, `auth`, `ee`, `lib`, `prisma`, `tailwind-config`, `trpc`, `ui` — about 38 MB total). This is needed because some runtime code and the manual admin-creation script (see below) read directly from these packages' source files.
- The Prisma Client, regenerated fresh in this clean environment.
- `tsx` and `dotenv-cli` — two developer tools that would normally be excluded by `--omit=dev`, kept specifically so an admin user can be created manually inside a running container (see "Manual Admin Script" below).
- `docker/start.sh` as the container's startup script.
- Runs as a non-root user (`nodejs`) rather than root, as a security best practice.

```dockerfile
CMD ["sh", "start.sh"]
```

### Why `start.sh` instead of running the server directly?

Two things must happen in order every time the container starts: run any pending database migrations, then start the server. `CMD` can only launch one process, so `docker/start.sh` is a small script that does both, in sequence:

```sh
npx prisma migrate deploy --schema ../../packages/prisma/schema.prisma
HOSTNAME=0.0.0.0 node build/server/main.js
```

This is a deliberate design choice: migrations now run at **container startup**, not at **image build time**. The previous version of this Dockerfile ran migrations during `docker build`, which meant the build process needed live database credentials. Moving this to startup means:

- The build no longer needs any database access or secrets.
- The same, already-built image can be deployed to any environment (staging, production) without rebuilding — the correct environment's database gets migrated at startup based on whatever `.env` is passed to that container.

### Manual Admin Script

The image supports manually creating an admin user by running a script inside a live container:

```bash
docker exec -it <container_name> sh
cd /app/apps/remix
npm run with:env -- tsx ../../packages/prisma/scripts/create-wize-admin.ts
```

This requires `WIZE_ADMIN_EMAIL` and `WIZE_ADMIN_PASSWORD` to be set in the container's environment (already the case if they're in the `.env` file passed via `--env-file` when the container was started).

---

## 2. `deploy/build-and-push.sh` — build, test, and publish

Run on a local machine or CI, from the repository root.

```bash
./deploy/build-and-push.sh          # tags with the version from package.json
./deploy/build-and-push.sh 2.14.0   # or pass an explicit version tag
```

**Prerequisites:** `docker login` has already been run once (to authenticate with Docker Hub).

**What it does, step by step:**

1. **Build** — builds the image and tags it two ways:
   - `imageshub1/documenso:<version>` — a permanent, versioned snapshot. This tag is never overwritten by later builds (as long as the version changes), so it always remains available as a rollback target.
   - `imageshub1/documenso:latest` — a moving pointer to "whatever was built most recently," for convenience.
   
   Both tags point at the exact same image; there is only one build.

2. **Smoke test** — starts a temporary container from the freshly built image and polls `http://localhost:3020/api/health` for up to 30 seconds. If the app doesn't respond in time, the script fails before anything is pushed, and prints the container's logs to help diagnose the problem. *(This is a placeholder check — swap it for a fuller test suite if/when one exists.)*

3. **Push** — uploads both tags to Docker Hub. Note: this does **not** upload the image data twice. Since both tags point to identical content, Docker Hub recognizes the second tag's data already exists and only needs to register the new tag name — this step finishes almost instantly.

---

## 3. `deploy/run-on-server.sh` — deploy on the server

Run on the server, in the same directory as the server's `.env` file.

```bash
./deploy/run-on-server.sh          # pulls and runs :latest
./deploy/run-on-server.sh 2.14.0   # pulls and runs a specific version (e.g. for rollback)
```

**What it does, step by step, and why the order matters:**

1. **Pull the new image first**, *before* touching the currently running container. The old container keeps serving traffic during this step. Since the image is roughly 1.4–1.5 GB, this download can take a noticeable amount of time — doing it first means that time does not count as downtime.

2. **Stop and remove the old container.** This is the only point where the site is briefly unavailable — typically a couple of seconds, since the image is already downloaded and only the container swap remains.

3. **Start the new container** with:
   - `--restart unless-stopped` — automatically restarts if it crashes or the server reboots, but stays stopped if manually stopped (doesn't fight a deliberate maintenance stop).
   - `--env-file .env` — passes environment variables (database URL, secrets, etc.) into the container.
   - `-p 3020:3020` — exposes the app on port 3020.
   - JSON log rotation (`max-size=10m`, `max-file=3`) — caps container logs at roughly 30 MB total, preventing unbounded disk usage over time.

4. **Clean up the old image**, after the swap so it doesn't add to downtime. The script captures the old image's ID *before* pulling, so it can precisely identify and remove only the now-outdated image afterward — never the new one.

### How image tags and rollback work

A tag like `latest` is just a movable label pointing at a specific image (identified internally by a unique content hash). When a new image is pushed under the same tag, the tag simply moves to point at the new image; the previous image isn't automatically deleted from Docker Hub. This is why `run-on-server.sh` always tracks the exact image ID it's replacing — tags can move, but the script never loses track of which image is actually old.

**To roll back to a previous version:**

```bash
./deploy/run-on-server.sh 2.13.0
```

This is only possible because `build-and-push.sh` publishes a permanent version tag alongside `latest` — if only `latest` were ever pushed, the previous version would become unlabeled and effectively unrecoverable without already knowing its exact image ID.

---

## Summary

| Concern | How it's handled |
|---|---|
| Image size | `turbo prune` + production-only install → ~1.4 GB (down from ~2.2 GB) |
| Build-time DB access | Not needed — migrations moved to container startup |
| Deploy downtime | Minimized by pulling before stopping the old container |
| Rollback | Supported via permanent version tags (not just `latest`) |
| Manual admin creation | Supported via `tsx`/`dotenv-cli` kept in the runtime image |
| Security | Runs as non-root user inside the container |