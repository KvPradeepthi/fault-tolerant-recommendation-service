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
