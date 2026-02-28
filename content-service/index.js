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
