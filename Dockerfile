FROM node:24-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY index.html styles.css app.js firebase-client.js server.mjs firestore-store.mjs sheets-directory.mjs ./

RUN mkdir -p /app/data

ENV HOST=0.0.0.0
ENV PORT=4173
ENV DATA_FILE=/app/data/nshm-clubs.sqlite

EXPOSE 4173

CMD ["node", "server.mjs"]
