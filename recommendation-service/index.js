const express = require('express');
const axios = require('axios');

// Circuit Breaker Implementation
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
    // Check if we need to transition from OPEN to HALF_OPEN
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
        console.log(`[${this.name}] Circuit breaker CLOSED after successful HALF_OPEN trials`);
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
      console.log(`[${this.name}] Circuit breaker OPEN - trial failed`);
    } else if (this.state === 'CLOSED') {
      // Check both conditions: consecutive failures and failure rate
      const failureRate = this.requestHistory.length > 0
        ? (this.requestHistory.filter(r => !r.success).length / this.requestHistory.length) * 100
        : 0;

      if (this.failureCount >= this.failureThreshold) {
        this.state = 'OPEN';
        console.log(`[${this.name}] Circuit breaker OPEN - ${this.failureCount} consecutive failures`);
      } else if (failureRate >= this.failureRateThreshold && this.requestHistory.length >= this.failureRateWindow) {
        this.state = 'OPEN';
        console.log(`[${this.name}] Circuit breaker OPEN - ${failureRate.toFixed(1)}% failure rate`);
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
app.use(express.json());

// Circuit Breakers for each dependency
const breakers = {
  userProfile: new CircuitBreaker('userProfile', {
    timeout: 2000,
    failureThreshold: 5,
    failureRateThreshold: 50,
    failureRateWindow: 10,
    openDuration: 30000,
    halfOpenTrials: 3
  }),
  content: new CircuitBreaker('content', {
    timeout: 2000,
    failureThreshold: 5,
    failureRateThreshold: 50,
    failureRateWindow: 10,
    openDuration: 30000,
    halfOpenTrials: 3
  })
};

// Service state simulation
const serviceStates = {
  'user-profile': 'normal',
  'content': 'normal'
};

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'healthy' });
});

// Simulate service behavior endpoint
app.post('/simulate/:service/:behavior', (req, res) => {
  const { service, behavior } = req.params;
  if (['user-profile', 'content'].includes(service) && ['normal', 'slow', 'fail'].includes(behavior)) {
    serviceStates[service] = behavior;
    res.json({ message: `${service} set to ${behavior}` });
  } else {
    res.status(400).json({ error: 'Invalid parameters' });
  }
});

// Mock service call with simulated behavior
async function mockServiceCall(baseUrl, behavior, dataType) {
  if (behavior === 'slow') {
    await new Promise(r => setTimeout(r, 3000));
  } else if (behavior === 'fail') {
    throw new Error('Service Error - 500');
  }

  // Return mock data based on type
  if (dataType === 'user') {
    return { userId: '123', preferences: ['Action', 'Sci-Fi'] };
  } else if (dataType === 'movies') {
    return [
      { movieId: 101, title: 'Inception', genre: 'Sci-Fi' },
      { movieId: 102, title: 'The Dark Knight', genre: 'Action' }
    ];
  } else if (dataType === 'trending') {
    return [{ movieId: 99, title: 'Trending Movie 1' }];
  }
}

// Main recommendations endpoint
app.get('/recommendations/:userId', async (req, res) => {
  const { userId } = req.params;
  const userProfileURL = process.env.USER_PROFILE_URL || 'http://user-profile-service:8081';
  const contentURL = process.env.CONTENT_URL || 'http://content-service:8082';
  const trendingURL = process.env.TRENDING_URL || 'http://trending-service:8083';

  try {
    // Fetch user preferences with circuit breaker
    let userPreferences;
    let userProfileFailed = false;
    try {
      userPreferences = await breakers.userProfile.execute(() =>
        mockServiceCall(userProfileURL, serviceStates['user-profile'], 'user')
      );
    } catch (e) {
      userProfileFailed = true;
      userPreferences = { userId, preferences: ['Comedy', 'Family'] }; // Fallback
      console.log('User Profile fallback triggered:', e.message);
    }

    // Fetch content with circuit breaker
    let recommendations;
    let contentFailed = false;
    try {
      recommendations = await breakers.content.execute(() =>
        mockServiceCall(contentURL, serviceStates['content'], 'movies')
      );
    } catch (e) {
      contentFailed = true;
      recommendations = []; // Will use trending as fallback
      console.log('Content fallback triggered:', e.message);
    }

    // If both circuits open, use trending service
    if (breakers.userProfile.state === 'OPEN' && breakers.content.state === 'OPEN') {
      const trending = await mockServiceCall(trendingURL, 'normal', 'trending');
      return res.json({
        message: 'Our recommendation service is temporarily degraded. Here are some trending movies.',
        trending: trending,
        fallback_triggered_for: 'user-profile-service, content-service'
      });
    }

    // If only user-profile circuit is open, use default preferences
    if (breakers.userProfile.state === 'OPEN') {
      return res.json({
        userPreferences: {
          userId: userId,
          preferences: ['Comedy', 'Family']
        },
        recommendations: recommendations,
        fallback_triggered_for: 'user-profile-service'
      });
    }

    // If only content circuit is open, use trending
    if (breakers.content.state === 'OPEN') {
      const trending = await mockServiceCall(trendingURL, 'normal', 'trending');
      return res.json({
        userPreferences,
        trending: trending,
        message: 'Using trending movies as fallback',
        fallback_triggered_for: 'content-service'
      });
    }

    // Both circuits are CLOSED - normal operation
    res.json({
      userPreferences,
      recommendations
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Metrics endpoint
app.get('/metrics/circuit-breakers', (req, res) => {
  res.json({
    userProfileCircuitBreaker: breakers.userProfile.getMetrics(),
    contentCircuitBreaker: breakers.content.getMetrics()
  });
});

const PORT = process.env.API_PORT || 8080;
app.listen(PORT, () => {
  console.log(`Recommendation Service running on port ${PORT}`);
});
