FROM node:20-alpine

WORKDIR /app

COPY package.json .
COPY prisma.config.ts .
RUN npm install --production

COPY prisma .
RUN npm run build

COPY server.js .

EXPOSE 3000

CMD ["node", "server.js"]
