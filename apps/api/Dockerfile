# Nest API production image (repo root as docker context).
# Build: docker build -f apps/api/Dockerfile -t sentinelgrid-api .
# Render uses dockerfilePath ./apps/api/Dockerfile + dockerContext .

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
RUN npm ci
COPY apps/api apps/api
COPY packages/shared packages/shared
RUN npm run build -w @sentinelgrid/shared && npm run build -w @sentinelgrid/api

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
ARG GIT_SHA=
ENV GIT_SHA=$GIT_SHA
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
RUN npm ci --omit=dev \
  && chown -R node:node /app
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/packages/shared packages/shared
USER node
EXPOSE 8080
CMD ["npm", "run", "start", "-w", "@sentinelgrid/api"]
