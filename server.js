require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const crypto = require('crypto');

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

app.post('/api/rooms', (req, res) => {
  const roomId = crypto.randomBytes(4).toString('hex');
  const { mood } = req.body;
  rooms[roomId] = { members: [], locked: false, mood: mood || 'any', excluded: [] };
  res.json({ roomId, mood });
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
  const { name, movieIds } = req.body;
  if (!rooms[roomId]) return res.status(404).json({ error: 'Room not found' });
  if (rooms[roomId].locked) return res.status(400).json({ error: 'Room is locked' });
  rooms[roomId].members.push({ name, movieIds });
  res.json({ success: true, members: rooms[roomId].members.length });
});

app.get('/api/rooms/:roomId/members', (req, res) => {
  const { roomId } = req.params;
  const room = rooms[roomId];
  if (!room) return res.status(404).json({ error: 'Room not found' });
  res.json({ members: room.members.map(m => m.name), locked: room.locked });
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

  let topGenres = Object.entries(genreCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([id]) => id);

  // Blend mood genres in
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

  // Get trailer
  const videos = await axios.get(`${TMDB_BASE}/movie/${pick.id}/videos`, {
    params: { api_key: TMDB_KEY }
  });
  const trailer = videos.data.results.find(v => v.type === 'Trailer' && v.site === 'YouTube');

  // Get streaming
  const providers = await axios.get(`${TMDB_BASE}/movie/${pick.id}/watch/providers`, {
    params: { api_key: TMDB_KEY }
  });
  const streaming = providers.data.results?.US?.flatrate?.map(p => p.provider_name) || [];

  const genreNames = {};
  for (const movie of allMovies) {
    for (const g of movie.genres || []) genreNames[g.id] = g.name;
  }

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
    members: room.members.map(m => m.name)
  };
}

app.get('/api/rooms/:roomId/recommend', async (req, res) => {
  const { roomId } = req.params;
  const room = rooms[roomId];
  if (!room) return res.status(404).json({ error: 'Room not found' });
  if (room.members.length < 1) return res.status(400).json({ error: 'No members yet' });
  try {
    const result = await findRecommendation(room, room.excluded);
    if (!result) return res.status(404).json({ error: 'No recommendation found' });
    room.excluded.push(result.id);
    room.locked = true;
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
    res.json(result);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Failed to find another movie' });
  }
});

app.listen(3000, () => console.log('WatchMatch running on http://localhost:3000'));
