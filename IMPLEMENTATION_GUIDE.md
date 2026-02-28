# Implementation Guide - Fault-Tolerant Recommendation Service

This guide provides step-by-step instructions to implement all four microservices with the Circuit Breaker pattern.

## Quick Setup

```bash
git clone <repo-url>
cd fault-tolerant-recommendation-service
docker-compose up -d
```

## Service Implementation Steps

### 1. Recommendation Service (recommendation-service/)

Create the following files in the `recommendation-service` directory:

#### recommendation-service/Dockerfile
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=5s --retries=5 \
  CMD curl -f http://localhost:8080/health || exit 1
CMD ["npm", "start"]
```

#### recommendation-service/index.js

Key Implementation Points:
- Express server on port 8080
- Circuit Breaker class for managing state (CLOSED, OPEN, HALF-OPEN)
- Timeout management (2 seconds)
- Failure tracking (5 consecutive OR 50% over 10 requests)
- Fallback mechanisms
- Three main endpoints:
  - GET /recommendations/{userId}
  - POST /simulate/{service}/{behavior}
  - GET /metrics/circuit-breakers
  - GET /health

Essential Code Structure:
```javascript
const express = require('express');
const axios = require('axios');

class CircuitBreaker {
  constructor(name, options = {}) {
    this.name = name;
    this.state = 'CLOSED';
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = null;
    this.timeout = options.timeout || 2000;
    this.failureThreshold = options.failureThreshold || 5;
    this.failureRateThreshold = options.failureRateThreshold || 50;
    this.failureRateWindow = options.failureRateWindow || 10;
    this.openDuration = options.openDuration || 30000;
    this.halfOpenTrials = options.halfOpenTrials || 3;
    this.trialCount = 0;
    this.requestHistory = [];
  }
  
  async execute(fn) {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailureTime > this.openDuration) {
        this.state = 'HALF_OPEN';
        this.trialCount = 0;
      } else {
        throw new Error(`Circuit breaker ${this.name} is OPEN`);
      }
    }
    
    try {
      const result = await Promise.race([
        fn(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Timeout')), this.timeout)
        )
      ]);
      
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }
  
  onSuccess() {
    this.successCount++;
    this.requestHistory.push({ success: true });
    if (this.requestHistory.length > this.failureRateWindow) {
      this.requestHistory.shift();
    }
    
    if (this.state === 'HALF_OPEN') {
      this.trialCount++;
      if (this.trialCount >= this.halfOpenTrials) {
        this.state = 'CLOSED';
        this.failureCount = 0;
      }
    } else if (this.state === 'CLOSED') {
      this.failureCount = 0;
    }
  }
  
  onFailure() {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    this.requestHistory.push({ success: false });
    if (this.requestHistory.length > this.failureRateWindow) {
      this.requestHistory.shift();
    }
    
    if (this.state === 'HALF_OPEN') {
      this.state = 'OPEN';
      this.trialCount = 0;
    } else if (this.state === 'CLOSED') {
      const failureRate = (this.requestHistory.filter(r => !r.success).length / this.requestHistory.length) * 100;
      if (this.failureCount >= this.failureThreshold || failureRate >= this.failureRateThreshold) {
        this.state = 'OPEN';
      }
    }
  }
  
  getMetrics() {
    const failureRate = this.requestHistory.length > 0 
      ? ((this.requestHistory.filter(r => !r.success).length / this.requestHistory.length) * 100).toFixed(1)
      : '0.0';
    
    return {
      state: this.state,
      failureRate: failureRate + '%',
      successfulCalls: this.successCount,
      failedCalls: this.failureCount
    };
  }
}

const app = express();
const breakers = {
  userProfile: new CircuitBreaker('userProfile'),
  content: new CircuitBreaker('content')
};

// Service state simulation
const serviceStates = {
  'user-profile': 'normal',
  'content': 'normal'
};

app.get('/health', (req, res) => {
  res.json({ status: 'healthy' });
});

app.post('/simulate/:service/:behavior', (req, res) => {
  const { service, behavior } = req.params;
  if (['user-profile', 'content'].includes(service) && ['normal', 'slow', 'fail'].includes(behavior)) {
    serviceStates[service] = behavior;
    res.json({ message: `${service} set to ${behavior}` });
  } else {
    res.status(400).json({ error: 'Invalid parameters' });
  }
});

app.get('/recommendations/:userId', async (req, res) => {
  const { userId } = req.params;
  const userProfileURL = process.env.USER_PROFILE_URL;
  const contentURL = process.env.CONTENT_URL;
  const trendingURL = process.env.TRENDING_URL;
  
  try {
    // Fetch user preferences with circuit breaker
    let userPreferences;
    try {
      userPreferences = await breakers.userProfile.execute(() => 
        mockServiceCall(userProfileURL + '/user/' + userId, serviceStates['user-profile'])
      );
    } catch (e) {
      userPreferences = { userId, preferences: ['Comedy', 'Family'] }; // Fallback
    }
    
    // Fetch content with circuit breaker
    let recommendations;
    try {
      recommendations = await breakers.content.execute(() => 
        mockServiceCall(contentURL + '/movies', serviceStates['content'])
      );
    } catch (e) {
      recommendations = []; // Will use trending as fallback
    }
    
    // If both circuits open, use trending service
    if (breakers.userProfile.state === 'OPEN' && breakers.content.state === 'OPEN') {
      const trending = await mockServiceCall(trendingURL + '/trending', 'normal');
      return res.json({
        message: 'Recommendation service temporarily degraded',
        trending: trending,
        fallback_triggered_for: 'user-profile-service, content-service'
      });
    }
    
    res.json({
      userPreferences,
      recommendations,
      ...(breakers.userProfile.state === 'OPEN' && { fallback_triggered_for: 'user-profile-service' })
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/metrics/circuit-breakers', (req, res) => {
  res.json({
    userProfileCircuitBreaker: breakers.userProfile.getMetrics(),
    contentCircuitBreaker: breakers.content.getMetrics()
  });
});

async function mockServiceCall(url, state) {
  if (state === 'slow') {
    await new Promise(r => setTimeout(r, 3000));
  } else if (state === 'fail') {
    throw new Error('Service Error');
  }
  // Return mock data
  if (url.includes('/user/')) {
    return { userId: '123', preferences: ['Action', 'Sci-Fi'] };
  } else if (url.includes('/movies')) {
    return [
      { movieId: 101, title: 'Inception', genre: 'Sci-Fi' },
      { movieId: 102, title: 'The Dark Knight', genre: 'Action' }
    ];
  } else if (url.includes('/trending')) {
    return [{ movieId: 99, title: 'Trending Movie 1' }];
  }
}

const PORT = process.env.API_PORT || 8080;
app.listen(PORT, () => {
  console.log(`Recommendation Service running on port ${PORT}`);
});
```

### 2. Mock Services (user-profile-service, content-service, trending-service)

Each mock service has a similar structure:

#### Mock Service Dockerfile
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
EXPOSE 8081
HEALTHCHECK --interval=10s --timeout=5s --retries=5 \
  CMD curl -f http://localhost:8081/health || exit 1
CMD ["npm", "start"]
```

#### Mock Service package.json (all three)
```json
{
  "name": "[service-name]",
  "version": "1.0.0",
  "main": "index.js",
  "scripts": {
    "start": "node index.js"
  },
  "dependencies": {
    "express": "^4.18.2"
  }
}
```

#### user-profile-service/index.js
```javascript
const express = require('express');
const app = express();

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/user/:id', (req, res) => {
  res.json({
    userId: req.params.id,
    preferences: ['Action', 'Sci-Fi']
  });
});

app.listen(8081, () => {
  console.log('User Profile Service running on port 8081');
});
```

#### content-service/index.js
```javascript
const express = require('express');
const app = express();

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/movies', (req, res) => {
  res.json([
    { movieId: 101, title: 'Inception', genre: 'Sci-Fi' },
    { movieId: 102, title: 'The Dark Knight', genre: 'Action' }
  ]);
});

app.listen(8082, () => {
  console.log('Content Service running on port 8082');
});
```

#### trending-service/index.js
```javascript
const express = require('express');
const app = express();

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/trending', (req, res) => {
  res.json([
    { movieId: 99, title: 'Trending Movie 1' }
  ]);
});

app.listen(8083, () => {
  console.log('Trending Service running on port 8083');
});
```

## Testing the Implementation

After running `docker-compose up -d`, test with:

```bash
# Test basic recommendation
curl http://localhost:8080/recommendations/123

# Trigger timeout failure
curl -X POST http://localhost:8080/simulate/user-profile/slow
for i in {1..5}; do curl http://localhost:8080/recommendations/123; done

# Check circuit state
curl http://localhost:8080/metrics/circuit-breakers

# Recovery after 31 seconds
curl -X POST http://localhost:8080/simulate/user-profile/normal
curl http://localhost:8080/recommendations/123
```

All services should become healthy and accessible. The recommendation service will orchestrate calls with circuit breaker protection.
