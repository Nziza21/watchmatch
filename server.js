require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const crypto = require('crypto');
const path = require('path');

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static('public'));

const TMDB_KEY = process.env.TMDB_API_KEY;
const TMDB_BASE = 'https://api.themoviedb.org/3';

const rooms = {};

const MOOD_GENRES = {
  'feel-good':    [35, 10751, 10402],
  'thrilling':    [28, 53, 80],
  'emotional':    [18, 10749],
  'mind-bending': [878, 9648, 14],
  'any':          []
};

const MOOD_LABELS = {
  'any':          '🎬 Surprise me',
  'feel-good':    '😄 Feel-good',
  'thrilling':    '⚡ Thrilling',
  'emotional':    '🥺 Emotional',
  'mind-bending': '🌀 Mind-bending'
};

// Landing page at root
app.get('/favicon.svg', (req, res) => {
  res.setHeader('Content-Type', 'image/svg+xml');
  res.send(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
    <rect width="100" height="100" rx="20" fill="#e50914"/>
    <text x="50" y="68" font-family="Inter,sans-serif" font-size="52" font-weight="900" text-anchor="middle" fill="white">W</text>
  </svg>`);
});
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'landing.html'));
});

// App page
app.get('/app', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'app.html'));
});

// Get popular movie posters for background
app.get('/api/posters', async (req, res) => {
  try {
    const [p1, p2, p3] = await Promise.all([
      axios.get(`${TMDB_BASE}/movie/popular`, { params: { api_key: TMDB_KEY, page: 1 } }),
      axios.get(`${TMDB_BASE}/movie/popular`, { params: { api_key: TMDB_KEY, page: 2 } }),
      axios.get(`${TMDB_BASE}/movie/top_rated`, { params: { api_key: TMDB_KEY, page: 1 } })
    ]);
    const all = [...p1.data.results, ...p2.data.results, ...p3.data.results];
    const posters = all
      .filter(m => m.poster_path)
      .map(m => `https://image.tmdb.org/t/p/w200${m.poster_path}`);
    res.json(posters);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch posters' });
  }
});

app.post('/api/rooms', (req, res) => {
  const roomId = crypto.randomBytes(4).toString('hex');
  const { mood } = req.body;
  rooms[roomId] = {
    members: [], locked: false, mood: mood || 'any',
    excluded: [], moodVotes: {}, result: null
  };
  res.json({ roomId, mood: mood || 'any' });
});

app.get('/api/search', async (req, res) => {
  const { q } = req.query;
  try {
    const response = await axios.get(`${TMDB_BASE}/search/movie`, {
      params: { api_key: TMDB_KEY, query: q }
    });
    const results = response.data.results.slice(0, 5).map(m => ({
      id: m.id,
      title: m.title,
      year: m.release_date?.split('-')[0],
      poster: m.poster_path ? `https://image.tmdb.org/t/p/w200${m.poster_path}` : null
    }));
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: 'Search failed' });
  }
});

app.post('/api/rooms/:roomId/submit', async (req, res) => {
  const { roomId } = req.params;
  const { name, movieIds, mood } = req.body;
  if (!rooms[roomId]) return res.status(404).json({ error: 'Room not found' });
  if (rooms[roomId].locked) return res.status(400).json({ error: 'Room is locked' });
  rooms[roomId].members.push({ name, movieIds });
  if (mood) {
    rooms[roomId].moodVotes[name] = mood;
    const votes = Object.values(rooms[roomId].moodVotes);
    const count = {};
    votes.forEach(v => count[v] = (count[v] || 0) + 1);
    const winner = Object.entries(count).sort((a, b) => b[1] - a[1])[0][0];
    rooms[roomId].mood = winner;
  }
  res.json({ success: true, members: rooms[roomId].members.length });
});

app.get('/api/rooms/:roomId/members', (req, res) => {
  const { roomId } = req.params;
  const room = rooms[roomId];
  if (!room) return res.status(404).json({ error: 'Room not found' });
  res.json({
    members: room.members.map(m => m.name),
    locked: room.locked,
    moodVotes: room.moodVotes,
    currentMood: room.mood,
    result: room.result
  });
});

async function findRecommendation(room, excludeIds = []) {
  const allMovies = [];
  for (const member of room.members) {
    for (const id of member.movieIds) {
      const r = await axios.get(`${TMDB_BASE}/movie/${id}`, {
        params: { api_key: TMDB_KEY }
      });
      allMovies.push(r.data);
    }
  }

  const genreCount = {};
  for (const movie of allMovies) {
    for (const genre of movie.genres || []) {
      genreCount[genre.id] = (genreCount[genre.id] || 0) + 1;
    }
  }

  const topGenres = Object.entries(genreCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([id]) => id);

  const moodGenres = MOOD_GENRES[room.mood] || [];
  const blendedGenres = [...new Set([...moodGenres, ...topGenres])].slice(0, 3);

  const recResponse = await axios.get(`${TMDB_BASE}/discover/movie`, {
    params: {
      api_key: TMDB_KEY,
      with_genres: blendedGenres.join(','),
      sort_by: 'vote_average.desc',
      'vote_count.gte': 500,
      page: Math.floor(Math.random() * 3) + 1
    }
  });

  const submittedIds = allMovies.map(m => m.id);
  const allExcluded = [...submittedIds, ...excludeIds];
  const pick = recResponse.data.results.find(m => !allExcluded.includes(m.id));
  if (!pick) return null;

  const videos = await axios.get(`${TMDB_BASE}/movie/${pick.id}/videos`, {
    params: { api_key: TMDB_KEY }
  });
  const trailer = videos.data.results.find(v => v.type === 'Trailer' && v.site === 'YouTube');

  const providers = await axios.get(`${TMDB_BASE}/movie/${pick.id}/watch/providers`, {
    params: { api_key: TMDB_KEY }
  });
  const streaming = providers.data.results?.US?.flatrate?.map(p => p.provider_name) || [];

  const genreNames = {};
  for (const movie of allMovies) {
    for (const g of movie.genres || []) genreNames[g.id] = g.name;
  }

  const votes = Object.values(room.moodVotes);
  const voteCount = {};
  votes.forEach(v => voteCount[v] = (voteCount[v] || 0) + 1);
  const voteSummary = Object.entries(voteCount)
    .sort((a, b) => b[1] - a[1])
    .map(([mood, count]) => `${MOOD_LABELS[mood]} (${count})`)
    .join(', ');

  return {
    id: pick.id,
    title: pick.title,
    year: pick.release_date?.split('-')[0],
    poster: pick.poster_path ? `https://image.tmdb.org/t/p/w500${pick.poster_path}` : null,
    backdrop: pick.backdrop_path ? `https://image.tmdb.org/t/p/w1280${pick.backdrop_path}` : null,
    overview: pick.overview,
    rating: pick.vote_average?.toFixed(1),
    genres: blendedGenres.map(id => genreNames[id]).filter(Boolean),
    streaming,
    trailerKey: trailer ? trailer.key : null,
    members: room.members.map(m => m.name),
    mood: room.mood,
    moodLabel: MOOD_LABELS[room.mood],
    voteSummary: voteSummary || null
  };
}

app.get('/api/rooms/:roomId/recommend', async (req, res) => {
  const { roomId } = req.params;
  const room = rooms[roomId];
  if (!room) return res.status(404).json({ error: 'Room not found' });
  if (room.members.length < 2) return res.status(400).json({ error: 'Need at least 2 people to get a recommendation!' });
  if (room.result) return res.json(room.result);
  try {
    const result = await findRecommendation(room, room.excluded);
    if (!result) return res.status(404).json({ error: 'No recommendation found' });
    room.excluded.push(result.id);
    room.locked = true;
    room.result = result;
    res.json(result);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Recommendation failed' });
  }
});

app.get('/api/rooms/:roomId/another', async (req, res) => {
  const { roomId } = req.params;
  const room = rooms[roomId];
  if (!room) return res.status(404).json({ error: 'Room not found' });
  try {
    const result = await findRecommendation(room, room.excluded);
    if (!result) return res.status(404).json({ error: 'No more recommendations' });
    room.excluded.push(result.id);
    room.result = result;
    res.json(result);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Failed to find another movie' });
  }
});

app.listen(3000, () => console.log('WatchMatch running on http://localhost:3000'));
