FROM node:22-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production

COPY --chown=node:node package.json package-lock.json server.js ./
RUN npm ci --omit=dev
COPY --chown=node:node src ./src
COPY --chown=node:node public ./public

USER node
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8787/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
