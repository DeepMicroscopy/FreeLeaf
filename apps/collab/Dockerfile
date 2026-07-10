FROM node:20-slim AS build
WORKDIR /app
COPY package.json ./
RUN npm install
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY --from=build /app/dist ./dist

# node:20-slim already ships a uid-1000 "node" user.
USER node

EXPOSE 1234

CMD ["node", "dist/server.js"]
