FROM node:22

WORKDIR /usr/src/app

COPY . .

RUN npm ci

RUN npm run build

CMD [ "node", "/usr/src/app/build/index.js" ]