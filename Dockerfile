FROM node:22-alpine

WORKDIR /app

COPY . .
RUN npm install 
RUN npm run db:generate

COPY server.js .

EXPOSE 3000

CMD [ "npm", "run", "db:migrate" ]
CMD ["node", "server.js"]

