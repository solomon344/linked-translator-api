FROM node:22-alpine

WORKDIR /app

COPY package*.json .
RUN npm install --only=production
COPY /prisma ./prisma

RUN ls
# COPY prisma.config.js .



COPY server.js .

RUN npm run db:generate



EXPOSE 3000


CMD ["sh", "-c", "echo DATABASE_URL=$DATABASE_URL && npm run db:migrate && node server.js"]

