FROM node:22-alpine

WORKDIR /app

COPY package*.json .
RUN npm install --only=production
COPY /prisma ./prisma

RUN ls
COPY prisma.config.js .
RUN npm run db:migrate && npm run db:generate


COPY server.js .



EXPOSE 3000


CMD ["node", "server.js"]

