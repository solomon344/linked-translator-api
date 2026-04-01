FROM node:24-alpine

WORKDIR /app

COPY package*.json .
RUN npm install 
COPY /prisma .
COPY prisma.config.js .
RUN ls
RUN npm run db:migrate && npm run db:generate


COPY server.js .



EXPOSE 3000


CMD ["node", "server.js"]

