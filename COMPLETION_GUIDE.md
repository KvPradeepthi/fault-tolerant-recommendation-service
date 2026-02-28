# Project Completion Guide

## Current Status
✅ Fully Completed:
- recommendation-service with complete Circuit Breaker implementation
- user-profile-service with package.json, index.js, Dockerfile
- content-service with package.json, index.js, Dockerfile
- All configuration files (docker-compose.yml, .env.example)
- Comprehensive documentation (README.md, IMPLEMENTATION_GUIDE.md)

⏳ Remaining (3 files only):
- trending-service/package.json
- trending-service/index.js  
- trending-service/Dockerfile

## Complete Remaining Files

### trending-service/package.json
```json
{"name": "trending-service", "version": "1.0.0", "main": "index.js", "scripts": {"start": "node index.js"}, "dependencies": {"express": "^4.18.2"}}
```

### trending-service/index.js
```javascript
const express = require('express');
const app = express();

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/trending', (req, res) => {
  res.json([
    { movieId: 99, title: 'Trending Movie 1' },
    { movieId: 100, title: 'Trending Movie 2' }
  ]);
});

app.listen(8083, () => {
  console.log('Trending Service running on port 8083');
});
```

### trending-service/Dockerfile
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
EXPOSE 8083
HEALTHCHECK --interval=10s --timeout=5s --retries=5 \
  CMD curl -f http://localhost:8083/health || exit 1
CMD ["npm", "start"]
```

## Quick Start (After Creating remaining files)

```bash
# 1. Clone the repository
git clone https://github.com/KvPradeepthi/fault-tolerant-recommendation-service

# 2. Build and start all services
docker-compose up -d

# 3. Wait for all services to become healthy (check with: docker-compose ps)

# 4. Test the recommendation endpoint
curl http://localhost:8080/recommendations/123

# 5. Run test scenarios from README.md
```

## Key Endpoints

- `GET /recommendations/{userId}` - Get recommendations
- `POST /simulate/{service}/{behavior}` - Control service behavior (normal/slow/fail)
- `GET /metrics/circuit-breakers` - View circuit breaker state
- `GET /health` - Health check

## Testing Circuit Breaker

1. Set user-profile-service to slow (3s delay):
   ```bash
   curl -X POST http://localhost:8080/simulate/user-profile/slow
   ```

2. Send 5 requests (will timeout at 2s):
   ```bash
   for i in {1..5}; do curl http://localhost:8080/recommendations/123; done
   ```

3. Check circuit state:
   ```bash
   curl http://localhost:8080/metrics/circuit-breakers
   ```

4. Circuit should be OPEN after 5 consecutive timeouts

## Verification Checklist

- [ ] All 4 services have package.json, index.js, Dockerfile
- [ ] docker-compose.yml is in root directory
- [ ] .env.example exists with all required variables
- [ ] All 4 containers start: `docker-compose up -d`
- [ ] All containers become healthy within 2 minutes
- [ ] /recommendations/{userId} endpoint returns 200 OK
- [ ] /simulate endpoints control service behavior
- [ ] /metrics/circuit-breakers shows circuit state
- [ ] Circuit opens after 5 timeout failures
- [ ] Circuit opens after 50% failure rate over 10 requests
- [ ] Circuit recovers after 30s + successful trials
