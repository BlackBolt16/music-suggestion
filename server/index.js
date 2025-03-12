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

// Mood-to-genre mapping for fallback recommendations (used as keywords)
const moodMappings = {
  happy: ['pop', 'dance', 'indie pop'],
  sad: ['sad', 'acoustic', 'blues'],
  energetic: ['rock', 'electronic', 'hip-hop'],
  relaxed: ['chill', 'ambient', 'acoustic'],
  angry: ['metal', 'punk', 'hard rock'],
  focused: ['study', 'instrumental', 'classical']
};

// ** Step 1: Authentication Flow **
app.get('/login', (req, res) => {
  const scopes = [
    'user-read-private',
    'user-read-email',
    'playlist-read-private',
    'user-top-read' // Required for personalized recommendations
  ];

  console.log('SPOTIFY_CLIENT_ID exists:', !!process.env.SPOTIFY_CLIENT_ID);

  if (!process.env.SPOTIFY_CLIENT_ID) {
    console.error('Client ID not found in environment variables!');
    return res.status(500).send('Spotify Client ID not configured');
  }

  const authorizeURL = spotifyApi.createAuthorizeURL(scopes);
  console.log('Redirecting to:', authorizeURL);
  res.redirect(authorizeURL);
});

// Handle authentication callback
app.get('/callback', async (req, res) => {
  const { code } = req.query;
  try {
    const data = await spotifyApi.authorizationCodeGrant(code);
    const { access_token, refresh_token } = data.body;
    spotifyApi.setAccessToken(access_token);
    spotifyApi.setRefreshToken(refresh_token);
    res.redirect('/#authenticated');
  } catch (err) {
    console.error('Error getting tokens:', err);
    res.redirect('/#error=authentication_failed');
  }
});

// ** Step 2: Get User Country for Market Filtering **
async function getUserCountry() {
  try {
    const userProfile = await spotifyApi.getMe();
    return userProfile.body.country || 'US'; // Default to US if not found
  } catch (error) {
    console.error('Error fetching user profile:', error);
    return 'US';
  }
}

// ** Step 3: Fetch User’s Top Tracks & Artists for Personalization **
async function getUserTopGenresAndArtists() {
  try {
    const topTracks = await spotifyApi.getMyTopTracks({ limit: 10 });
    if (!topTracks.body.items.length) {
      console.log('No top tracks found, falling back to mood keywords.');
      return null;
    }
    let seedArtists = [];
    for (const track of topTracks.body.items) {
      const artistId = track.artists[0]?.id;
      if (artistId) seedArtists.push(artistId);
    }
    return { seedArtists };
  } catch (error) {
    console.error('Error fetching user’s top tracks:', error);
    return null;
  }
}

// ** Step 4: Generate Personalized Song Recommendations **
app.get('/recommendations/:mood', async (req, res) => {
  const { mood } = req.params;
  try {
    // Refresh access token
    await spotifyApi.refreshAccessToken();
  } catch (err) {
    console.error('Could not refresh access token:', err);
  }

  try {
    const userCountry = await getUserCountry();
    let userData = await getUserTopGenresAndArtists();
    let query = "";

    // If we have a top artist, use its name combined with a mood keyword
    if (userData && userData.seedArtists && userData.seedArtists.length > 0) {
      const artistData = await spotifyApi.getArtist(userData.seedArtists[0]);
      const artistName = artistData.body.name;
      // Use the first keyword from the mood mapping as a hint
      const moodKeyword = moodMappings[mood] ? moodMappings[mood][0] : mood;
      query = `${artistName} ${moodKeyword}`;
    } else {
      // Fallback: join all mood keywords into a query string
      query = moodMappings[mood] ? moodMappings[mood].join(' ') : mood;
    }

    console.log(`Searching tracks with query: "${query}" and market: ${userCountry}`);
    const results = await spotifyApi.searchTracks(query, {
      limit: 10,
      market: userCountry
    });

    if (!results.body.tracks.items.length) {
      console.log('No results found from search.');
      return res.status(404).json({ error: 'No songs found for this mood' });
    }

    console.log(`Found ${results.body.tracks.items.length} tracks for mood "${mood}".`);
    res.json(results.body.tracks.items);
  } catch (err) {
    console.error('Error getting recommendations:', err);
    res.status(500).json({ error: 'Failed to get recommendations' });
  }
});

// ** Step 5: Fetch Playlists Based on Mood **
app.get('/playlists/:mood', async (req, res) => {
  const { mood } = req.params;
  try {
    const query = moodMappings[mood] ? moodMappings[mood].join(' ') : mood;
    const result = await spotifyApi.searchPlaylists(query, { limit: 5 });
    console.log(`Playlists for mood "${mood}":`, result.body.playlists?.items);
    res.json(result.body);
  } catch (err) {
    console.error('Error getting playlists:', err);
    res.status(500).json({ error: 'Failed to get playlists' });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
