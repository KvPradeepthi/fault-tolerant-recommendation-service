FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 8083
HEALTHCHECK --interval=10s --timeout=5s --retries=5 \
  CMD node -e "require('http').get('http://localhost:8083/health', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})" || exit 1
CMD [\"npm\", \"start\"]
