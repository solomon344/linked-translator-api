FROM node:20-alpine

WORKDIR /app

COPY package.json .
COPY prisma.config.ts .
COPY ./prisma .
RUN npm install 
RUN npm run db:migrate && npm run db:generate

COPY server.js .

EXPOSE 3000

CMD ["node", "server.js"]
