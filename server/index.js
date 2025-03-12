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
// Replace your /recommendations/:mood endpoint with this updated version
app.get('/recommendations/:mood', async (req, res) => {
    const { mood } = req.params;
    try {
      // Refresh access token
      try {
        const refreshData = await spotifyApi.refreshAccessToken();
        spotifyApi.setAccessToken(refreshData.body.access_token);
        console.log('Access token refreshed');
      } catch (err) {
        console.error('Could not refresh access token:', err);
      }
  
      const userCountry = await getUserCountry();
      
      // Get user's top artists and tracks for personalization
      let seedArtists = [];
      let seedTracks = [];
      let audioFeatures = {};
      
      try {
        // Get user's top artists
        const topArtists = await spotifyApi.getMyTopArtists({ limit: 3, time_range: 'medium_term' });
        if (topArtists.body.items.length > 0) {
          seedArtists = topArtists.body.items.map(artist => artist.id).slice(0, 2);
        }
        
        // Get user's top tracks
        const topTracks = await spotifyApi.getMyTopTracks({ limit: 5, time_range: 'medium_term' });
        if (topTracks.body.items.length > 0) {
          seedTracks = topTracks.body.items.map(track => track.id).slice(0, 3);
        }
        
        console.log(`Using ${seedArtists.length} seed artists and ${seedTracks.length} seed tracks`);
      } catch (error) {
        console.error('Error getting user top items:', error);
      }
      
      // Set audio features based on mood
      switch (mood) {
        case 'happy':
          audioFeatures = { min_valence: 0.7, target_energy: 0.8 };
          break;
        case 'sad':
          audioFeatures = { max_valence: 0.4, target_energy: 0.4 };
          break;
        case 'energetic':
          audioFeatures = { min_energy: 0.8, target_tempo: 120 };
          break;
        case 'relaxed':
          audioFeatures = { max_energy: 0.4, target_acousticness: 0.7 };
          break;
        case 'angry':
          audioFeatures = { min_energy: 0.8, max_valence: 0.4 };
          break;
        case 'focused':
          audioFeatures = { target_instrumentalness: 0.5, max_speechiness: 0.1 };
          break;
        default:
          audioFeatures = {};
      }
      
      let tracks = [];
      
      // Method 1: Try using Spotify's recommendations endpoint if we have seeds
      if ((seedArtists.length > 0 || seedTracks.length > 0)) {
        try {
          const recommendationsParams = {
            limit: 10,
            market: userCountry,
            seed_artists: seedArtists.slice(0, 2),
            seed_tracks: seedTracks.slice(0, 3),
            ...audioFeatures
          };
          
          console.log('Requesting recommendations with params:', recommendationsParams);
          
          const recommendations = await spotifyApi.getRecommendations(recommendationsParams);
          tracks = recommendations.body.tracks;
          
          console.log(`Got ${tracks.length} tracks from recommendations API`);
        } catch (recError) {
          console.error('Error getting recommendations from Spotify:', recError);
        }
      }
      
      // Method 2: Fallback to search if recommendations didn't work or return enough tracks
      if (tracks.length < 5) {
        console.log('Falling back to search API');
        // Use the first keyword from the mood mapping as a search term
        const moodKeywords = moodMappings[mood] || [mood];
        const query = moodKeywords.slice(0, 2).join(' ');
        
        try {
          const searchResults = await spotifyApi.searchTracks(query, {
            limit: 15,
            market: userCountry
          });
          
          // If we already have some tracks from recommendations, add unique ones from search
          if (tracks.length > 0) {
            const existingIds = new Set(tracks.map(t => t.id));
            const newTracks = searchResults.body.tracks.items.filter(t => !existingIds.has(t.id));
            tracks = [...tracks, ...newTracks].slice(0, 10);
          } else {
            tracks = searchResults.body.tracks.items;
          }
          
          console.log(`Got ${tracks.length} tracks after search fallback`);
        } catch (searchError) {
          console.error('Error searching tracks:', searchError);
          if (tracks.length === 0) {
            return res.status(404).json({ error: 'No songs found for this mood' });
          }
        }
      }
      
      // Return in the format the frontend expects
      res.json({ tracks });
    } catch (err) {
      console.error('Error in recommendations endpoint:', err);
      res.status(500).json({ error: 'Failed to get recommendations', details: err.message });
    }
  });

// ** Step 5: Fetch Playlists Based on Mood **
// Replace your /playlists/:mood endpoint with this updated version
// Updated playlists endpoint with debug logging
// Add this enhanced debug version of the playlists endpoint
// Updated playlists endpoint with null check fix
app.get('/playlists/:mood', async (req, res) => {
    const { mood } = req.params;
    try {
      console.log(`\n=== PLAYLIST REQUEST START for mood: ${mood} ===`);
      
      // Refresh access token if needed
      try {
        const refreshData = await spotifyApi.refreshAccessToken();
        spotifyApi.setAccessToken(refreshData.body.access_token);
        console.log('✅ Access token refreshed for playlist request');
      } catch (err) {
        console.error('❌ Could not refresh access token:', err.message);
      }
  
      // Get user's top genre to personalize playlists
      let userGenres = new Set();
      try {
        const topArtists = await spotifyApi.getMyTopArtists({ limit: 10 });
        
        // Extract genres from top artists
        if (topArtists && topArtists.body && topArtists.body.items) {
          topArtists.body.items.forEach(artist => {
            if (artist && artist.genres) {
              artist.genres.forEach(genre => userGenres.add(genre));
            }
          });
          console.log(`✅ Found ${userGenres.size} genres from user's top artists`);
        } else {
          console.log('⚠️ No top artists found');
        }
      } catch (error) {
        console.error('❌ Error getting user top artists for genres:', error.message);
      }
      
      // Create an array of search terms combining mood keywords and user genres
      const moodKeywords = moodMappings[mood] || [mood];
      const searchTerms = [];
      
      // Add mood-specific terms
      searchTerms.push(...moodKeywords.map(keyword => keyword));
      
      // Add combined user genre + mood terms if we have user genres
      if (userGenres.size > 0) {
        const userGenresArray = Array.from(userGenres).slice(0, 3);
        userGenresArray.forEach(genre => {
          searchTerms.push(`${genre} ${moodKeywords[0]}`);
        });
      }
      
      // Shuffle and limit search terms
      const shuffledTerms = searchTerms.sort(() => 0.5 - Math.random()).slice(0, 3);
      console.log('📋 Playlist search terms:', shuffledTerms);
      
      // Track all playlists we find
      let allPlaylists = [];
      
      // Search for each term
      for (const term of shuffledTerms) {
        try {
          console.log(`🔍 Searching for playlists with term: "${term}"`);
          const result = await spotifyApi.searchPlaylists(term, { limit: 3 });
          
          if (result && result.body && result.body.playlists && 
              Array.isArray(result.body.playlists.items)) {
            console.log(`✅ Found ${result.body.playlists.items.length} playlists for term "${term}"`);
            
            // Filter out any items that don't have an id
            const validPlaylists = result.body.playlists.items.filter(playlist => 
              playlist && playlist.id && playlist.name && 
              playlist.external_urls && playlist.external_urls.spotify
            );
            
            if (validPlaylists.length > 0) {
              // Log the structure of the first playlist
              const samplePlaylist = validPlaylists[0];
              console.log('📝 Sample playlist structure:', {
                id: samplePlaylist.id,
                name: samplePlaylist.name,
                hasImages: !!samplePlaylist.images,
                hasOwner: !!samplePlaylist.owner
              });
              
              allPlaylists.push(...validPlaylists);
            } else {
              console.log(`⚠️ Found ${result.body.playlists.items.length} playlists but none were valid`);
            }
          } else {
            console.log(`⚠️ No valid playlists found for term "${term}"`);
          }
        } catch (err) {
          console.error(`❌ Error searching playlists for term "${term}":`, err.message);
        }
      }
      
      // If we have no playlists, use hardcoded fallbacks
      if (allPlaylists.length === 0) {
        console.log('🆘 No playlists found, using fallback playlists');
        
        // Map of popular playlist IDs for each mood
        const popularPlaylists = {
          happy: ['37i9dQZF1DX9XIFQuFvzM4', '37i9dQZF1DX0jgyAiPl8Af'],
          sad: ['37i9dQZF1DX7qK8ma5wgG1', '37i9dQZF1DX889U0CL85jj'],
          energetic: ['37i9dQZF1DX76Wlfdnj7AP', '37i9dQZF1DX8VP5UEoyLy0'],
          relaxed: ['37i9dQZF1DX8Uebhn9wzrS', '37i9dQZF1DX4WYpdgoIcn6'],
          angry: ['37i9dQZF1DX4eRPd9frC1m', '37i9dQZF1DX3YSRoSdA634'],
          focused: ['37i9dQZF1DX8NTLI2TtZa6', '37i9dQZF1DX9sIqqvKsjG8']
        };
        
        // Default to happy if mood not found
        const playlistIds = popularPlaylists[mood] || popularPlaylists.happy;
        
        // Create simple playlists for the requested mood
        allPlaylists = playlistIds.map((id, index) => {
          return {
            id: id,
            name: `${mood.charAt(0).toUpperCase() + mood.slice(1)} Playlist ${index + 1}`,
            images: [{ url: 'https://i.scdn.co/image/ab67706f000000027cb759a8f6a058e6a07e2f0d' }],
            owner: { display_name: 'Spotify' },
            external_urls: { spotify: `https://open.spotify.com/playlist/${id}` }
          };
        });
        
        console.log(`✅ Created ${allPlaylists.length} hardcoded playlists`);
      }
      
      // Remove duplicates (by id) - with extra null/undefined check
      const uniquePlaylists = Array.from(
        new Map(allPlaylists
          .filter(playlist => playlist && playlist.id) // This is the critical fix
          .map(playlist => [playlist.id, playlist]))
          .values()
      );
      
      // Shuffle and limit to 8 playlists
      const shuffledPlaylists = uniquePlaylists
        .sort(() => 0.5 - Math.random())
        .slice(0, 8);
      
      console.log(`📊 Returning ${shuffledPlaylists.length} unique playlists for mood "${mood}"`);
      
      // Return in the format the frontend expects
      const response = { 
        playlists: { 
          items: shuffledPlaylists 
        } 
      };
      
      console.log('📦 Sending playlists response with structure:', {
        hasPlaylists: !!response.playlists,
        hasItems: !!(response.playlists && response.playlists.items),
        itemsIsArray: Array.isArray(response.playlists.items),
        itemsCount: response.playlists.items.length
      });
      
      console.log(`=== PLAYLIST REQUEST END for mood: ${mood} ===\n`);
      
      res.json(response);
    } catch (err) {
      console.error('❌ CRITICAL ERROR getting playlists:', err.message);
      
      // Return fallback playlists in case of error
      const fallbackPlaylists = [
        {
          id: "fallback1",
          name: `${mood.charAt(0).toUpperCase() + mood.slice(1)} Mix`,
          images: [{ url: 'https://i.scdn.co/image/ab67706f000000027cb759a8f6a058e6a07e2f0d' }],
          owner: { display_name: 'Spotify' },
          external_urls: { spotify: 'https://open.spotify.com/playlist/37i9dQZF1DX8NTLI2TtZa6' }
        },
        {
          id: "fallback2",
          name: `${mood.charAt(0).toUpperCase() + mood.slice(1)} Vibes`,
          images: [{ url: 'https://i.scdn.co/image/ab67706f000000025551996f9c5fe0578d6cf816' }],
          owner: { display_name: 'Spotify' },
          external_urls: { spotify: 'https://open.spotify.com/playlist/37i9dQZF1DX9XIFQuFvzM4' }
        }
      ];
      
      res.json({ 
        playlists: { 
          items: fallbackPlaylists
        }
      });
    }
  });
// Start the server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
