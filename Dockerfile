FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY --chown=node:node dist/ ./dist/
USER node
# Listen on all interfaces so the published port is reachable. The server refuses
# to start this way unless MCP_AUTH_TOKEN is set, e.g.
#   docker run -e MCP_AUTH_TOKEN=... -e PROTONMAIL_USER=... -e PROTONMAIL_PASS=... -p 127.0.0.1:3000:3000 ...
# Credentials are passed as environment variables; no config file is baked in.
ENV MCP_HOST=0.0.0.0
EXPOSE 3000
CMD ["node", "dist/server.js"]
