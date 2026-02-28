const express = require('express');
const app = express();
const port = process.env.PORT || 8083;

app.use(express.json());

const trendingMovies = [
  { movieId: 99, title: 'Trending Movie 1', genre: 'Action' },
  { movieId: 100, title: 'Trending Movie 2', genre: 'Comedy' },
  { movieId: 101, title: 'Trending Movie 3', genre: 'Drama' },
  { movieId: 102, title: 'Trending Movie 4', genre: 'Sci-Fi' },
  { movieId: 103, title: 'Trending Movie 5', genre: 'Thriller' }
];

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'UP' });
});

// Trending movies endpoint
app.get('/trending', (req, res) => {
  res.status(200).json({
    trending: trendingMovies,
    count: trendingMovies.length
  });
});

app.listen(port, () => {
  console.log(`Trending service listening on port ${port}`);
});
