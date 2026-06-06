FROM node:20-alpine AS base
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

FROM base AS dev
RUN npm install
COPY . .
CMD ["node", "--watch", "src/index.js"]

FROM base AS production
COPY . .
EXPOSE 8080
CMD ["npm", "start"]
