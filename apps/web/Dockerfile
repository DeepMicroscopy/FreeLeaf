# Build context is the repo root (see docker-compose.yml) so pnpm can see
# the workspace and the packages/shared dependency.
FROM node:20-slim

WORKDIR /repo

RUN npm install -g pnpm@9.15.0

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY apps/collab/package.json apps/collab/package.json

RUN pnpm install --frozen-lockfile

COPY packages/shared packages/shared
COPY apps/web apps/web

WORKDIR /repo/apps/web

EXPOSE 5173

CMD ["pnpm", "exec", "vite", "--host", "0.0.0.0", "--port", "5173"]
