FROM node:20-alpine
WORKDIR /app
COPY package.json package.json
COPY package-lock.json package-lock.json
COPY apps/web/ ./apps/web/
RUN npm install
EXPOSE 3000
CMD npm run dev --prefix apps/web

