FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
EXPOSE 8082
HEALTHCHECK --interval=10s --timeout=5s --retries=5 \
  CMD curl -f http://localhost:8082/health || exit 1
CMD ["npm", "start"]
