const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const SpotifyWebApi = require('spotify-web-api-node');
const path = require('path');


// Load environment variables
dotenv.config({ path: './server/.env' });

// Initialize express app
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Initialize Spotify API
const spotifyApi = new SpotifyWebApi({
  clientId: process.env.SPOTIFY_CLIENT_ID,
  clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
  redirectUri: process.env.REDIRECT_URI || 'http://localhost:3000/callback'
});

// Predefined mood-to-genre/playlist mapping
const moodMappings = {
  happy: { genres: ['pop', 'happy'], seedTracks: ['37i9dQZF1DXdPec7aLTmlC'] },
  sad: { genres: ['sad', 'rainy-day'], seedTracks: ['37i9dQZF1DX7qK8ma5wgG1'] },
  energetic: { genres: ['workout', 'power-pop'], seedTracks: ['37i9dQZF1DX76Wlfdnj7AP'] },
  relaxed: { genres: ['chill', 'ambient'], seedTracks: ['37i9dQZF1DX4WYpdgoIcn6'] },
  angry: { genres: ['rock', 'metal'], seedTracks: ['37i9dQZF1DWWJOmJ7nRx0C'] },
  focused: { genres: ['focus', 'study'], seedTracks: ['37i9dQZF1DX8NTLI2TIfZs'] }
};

// Authentication endpoint
app.get('/login', (req, res) => {
    const scopes = ['user-read-private', 'user-read-email', 'playlist-read-private'];
    
    // Debugging
    console.log('SPOTIFY_CLIENT_ID exists:', !!process.env.SPOTIFY_CLIENT_ID);
    
    // Manual redirect with client_id as fallback
    if (!process.env.SPOTIFY_CLIENT_ID) {
      console.error('Client ID not found in environment variables!');
      return res.status(500).send('Spotify Client ID not configured');
    }
    
    const authorizeURL = spotifyApi.createAuthorizeURL(scopes);
    console.log('Redirecting to:', authorizeURL);
    
    res.redirect(authorizeURL);
  });
// Callback after Spotify authentication
app.get('/callback', async (req, res) => {
  const { code } = req.query;
  
  try {
    const data = await spotifyApi.authorizationCodeGrant(code);
    const { access_token, refresh_token } = data.body;
    
    spotifyApi.setAccessToken(access_token);
    spotifyApi.setRefreshToken(refresh_token);
    
    // Redirect to the main page
    res.redirect('/#authenticated');
  } catch (err) {
    console.error('Error getting tokens:', err);
    res.redirect('/#error=authentication_failed');
  }
});

// Get recommendations based on mood
app.get('/recommendations/:mood', async (req, res) => {
  const { mood } = req.params;
  
  // Check if we need to refresh the token
  try {
    const data = await spotifyApi.refreshAccessToken();
    spotifyApi.setAccessToken(data.body.access_token);
  } catch (err) {
    console.log('Could not refresh access token', err);
  }
  
  // Get recommendations based on the mood
  try {
    if (!moodMappings[mood]) {
      return res.status(400).json({ error: 'Invalid mood' });
    }
    
    const { genres, seedTracks } = moodMappings[mood];
    
    // Get recommendations using seed genres and tracks
    const recommendations = await spotifyApi.getRecommendations({
      seed_genres: genres.slice(0, 2),
      seed_tracks: seedTracks.slice(0, 1),
      limit: 10
    });
    
    res.json(recommendations.body);
  } catch (err) {
    console.error('Error getting recommendations:', err);
    res.status(500).json({ error: 'Failed to get recommendations' });
  }
});

// Get featured playlists for a mood
app.get('/playlists/:mood', async (req, res) => {
  const { mood } = req.params;
  
  try {
    // Map mood to search query
    const queryMapping = {
      happy: 'happy',
      sad: 'sad',
      energetic: 'energy',
      relaxed: 'chill',
      angry: 'angry',
      focused: 'focus'
    };
    
    const query = queryMapping[mood] || mood;
    
    // Search for playlists related to the mood
    const result = await spotifyApi.searchPlaylists(query, { limit: 5 });
    res.json(result.body);
  } catch (err) {
    console.error('Error getting playlists:', err);
    res.status(500).json({ error: 'Failed to get playlists' });
  }
});
