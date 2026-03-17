FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY dist/ ./dist/
COPY config/ ./config/
EXPOSE 3000
CMD ["node", "dist/server.js"]
