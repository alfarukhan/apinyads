const express = require('express');
const axios = require('axios');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// Spotify configuration from environment variables with development fallbacks
const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID || 'demo_spotify_client_id';
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET || 'demo_spotify_client_secret';

// For development, we'll use mock data if credentials are not provided
const isDemoMode = !process.env.SPOTIFY_CLIENT_ID || !process.env.SPOTIFY_CLIENT_SECRET;

if (isDemoMode) {
  console.log('🎵 Spotify API running in DEMO mode - using mock data');
  console.log('💡 To use real Spotify API, set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET in .env file');
}

let spotifyAccessToken = null;
let tokenExpiry = null;

// Mock Spotify data for demo mode
const mockTrackData = {
  tracks: {
    items: [
      {
        id: "demo_track_1",
        name: "Electronic Dreams",
        artists: [{ id: "demo_artist_1", name: "Demo DJ" }],
        album: {
          id: "demo_album_1",
          name: "Future Beats",
          images: [{ url: "https://alfarukhan.my.id/artwork1.jpg", height: 640, width: 640 }]
        },
        duration_ms: 240000,
        preview_url: "https://example.com/preview1.mp3",
        external_urls: { spotify: "https://open.spotify.com/track/demo_track_1" },
        popularity: 85
      },
      {
        id: "demo_track_2",
        name: "Bass Drop Symphony",
        artists: [{ id: "demo_artist_2", name: "Festival Master" }],
        album: {
          id: "demo_album_2",
          name: "Dance Floor Anthems",
          images: [{ url: "https://alfarukhan.my.id/artwork2.jpg", height: 640, width: 640 }]
        },
        duration_ms: 195000,
        preview_url: "https://example.com/preview2.mp3",
        external_urls: { spotify: "https://open.spotify.com/track/demo_track_2" },
        popularity: 92
      }
    ],
    total: 50,
    limit: 20,
    offset: 0
  }
};

const mockArtistTopTracks = {
  tracks: [
    {
      id: "demo_top_1",
      name: "Festival Anthem",
      album: {
        id: "demo_album_3",
        name: "Greatest Hits",
        images: [{ url: "https://alfarukhan.my.id/artwork3.jpg", height: 640, width: 640 }]
      },
      duration_ms: 220000,
      preview_url: "https://example.com/preview3.mp3",
      external_urls: { spotify: "https://open.spotify.com/track/demo_top_1" },
      popularity: 95
    }
  ]
};

// Get Spotify access token
const getSpotifyToken = async () => {
  // Check if token is still valid
  if (spotifyAccessToken && tokenExpiry && new Date() < tokenExpiry) {
    return spotifyAccessToken;
  }

  try {
    const credentials = Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64');
    
    const response = await axios.post('https://accounts.spotify.com/api/token', 
      'grant_type=client_credentials',
      {
        headers: {
          'Authorization': `Basic ${credentials}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );

    spotifyAccessToken = response.data.access_token;
    const expiresIn = response.data.expires_in;
    tokenExpiry = new Date(Date.now() + (expiresIn - 60) * 1000); // 1 min buffer

    console.log('✅ Spotify token refreshed successfully');
    return spotifyAccessToken;
  } catch (error) {
    console.error('❌ Error getting Spotify token:', error.response?.data || error.message);
    throw new AppError('Failed to get Spotify access token', 500);
  }
};

// @route   GET /api/spotify/search
// @desc    Search Spotify tracks (proxied for security)
// @access  Private
router.get('/search', authMiddleware, asyncHandler(async (req, res) => {
  const { q, type = 'track', limit = 20, market = 'US' } = req.query;

  if (!q) {
    throw new AppError('Search query is required', 400);
  }

  // Return mock data in demo mode
  if (isDemoMode) {
    console.log(`🎵 Demo Spotify search: "${q}"`);
    
    // Simulate search-based filtering
    const filteredTracks = mockTrackData.tracks.items.filter(track => 
      track.name.toLowerCase().includes(q.toLowerCase()) ||
      track.artists.some(artist => artist.name.toLowerCase().includes(q.toLowerCase())) ||
      q.toLowerCase().includes('electronic') ||
      q.toLowerCase().includes('dance') ||
      q.toLowerCase().includes('music')
    );

    res.json({
      success: true,
      data: {
        tracks: {
          ...mockTrackData.tracks,
          items: filteredTracks.slice(0, Math.min(parseInt(limit), 20))
        }
      },
    });
    return;
  }

  try {
    const token = await getSpotifyToken();
    
    const response = await axios.get('https://api.spotify.com/v1/search', {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
      params: {
        q,
        type,
        limit,
        market, // Region affects availability of preview_url
      },
    });

    res.json({
      success: true,
      data: response.data,
    });
  } catch (error) {
    console.error('❌ Spotify search error:', error.response?.data || error.message);
    throw new AppError('Spotify search failed', 500);
  }
}));

// @route   GET /api/spotify/track/:id
// @desc    Get track details
// @access  Private
router.get('/track/:id', authMiddleware, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { market = 'US' } = req.query;

  // Return mock data in demo mode
  if (isDemoMode) {
    console.log(`🎵 Demo Spotify track details: ${id}`);
    
    const mockTrack = mockTrackData.tracks.items.find(track => track.id === id) || 
                     mockTrackData.tracks.items[0]; // fallback to first track

    res.json({
      success: true,
      data: mockTrack,
    });
    return;
  }

  try {
    const token = await getSpotifyToken();
    
    const response = await axios.get(`https://api.spotify.com/v1/tracks/${id}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
      params: {
        market,
      },
    });

    res.json({
      success: true,
      data: response.data,
    });
  } catch (error) {
    console.error('❌ Spotify track error:', error.response?.data || error.message);
    throw new AppError('Failed to get track details', 500);
  }
}));

// @route   GET /api/spotify/artist/:id/top-tracks
// @desc    Get artist's top tracks
// @access  Private
router.get('/artist/:id/top-tracks', authMiddleware, asyncHandler(async (req, res) => {
  const { id } = req.params;

  // Return mock data in demo mode
  if (isDemoMode) {
    console.log(`🎵 Demo Spotify artist top tracks: ${id}`);
    
    res.json({
      success: true,
      data: mockArtistTopTracks,
    });
    return;
  }

  try {
    const token = await getSpotifyToken();
    
    const response = await axios.get(`https://api.spotify.com/v1/artists/${id}/top-tracks`, {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
      params: {
        market: 'ID',
      },
    });

    res.json({
      success: true,
      data: response.data,
    });
  } catch (error) {
    console.error('❌ Spotify artist tracks error:', error.response?.data || error.message);
    throw new AppError('Failed to get artist top tracks', 500);
  }
}));

// @route   GET /api/spotify/playlist/:id/tracks
// @desc    Get tracks from a specific Spotify playlist
// @access  Private
router.get('/playlist/:id/tracks', authMiddleware, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { limit = 50, offset = 0 } = req.query;

  if (isDemoMode) {
    console.log(`🎵 Demo Spotify playlist tracks: ${id}`);
    
    // Return mock playlist tracks
    const mockPlaylistTracks = {
      items: mockTrackData.tracks.items.map(track => ({
        track: track,
        added_at: new Date().toISOString(),
        added_by: {
          id: "demo_user",
          type: "user"
        }
      })),
      total: mockTrackData.tracks.items.length,
      limit: parseInt(limit),
      offset: parseInt(offset)
    };

    res.json({
      success: true,
      data: mockPlaylistTracks,
    });
    return;
  }

  try {
    const token = await getSpotifyToken();
    
    const response = await axios.get(`https://api.spotify.com/v1/playlists/${id}/tracks`, {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
      params: {
        limit,
        offset,
        market: 'ID',
        fields: 'items(track(id,name,artists,album,duration_ms,preview_url,external_urls,popularity)),total,limit,offset'
      },
    });

    res.json({
      success: true,
      data: response.data,
    });
  } catch (error) {
    console.error('❌ Spotify playlist tracks error:', error.response?.data || error.message);
    throw new AppError('Failed to get playlist tracks', 500);
  }
}));

// @route   GET /api/spotify/playlist/:id
// @desc    Get Spotify playlist details
// @access  Private
router.get('/playlist/:id', authMiddleware, asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (isDemoMode) {
    console.log(`🎵 Demo Spotify playlist details: ${id}`);
    
    const mockPlaylist = {
      id: id,
      name: "Demo Daily Drop Playlist",
      description: "Electronic music for daily drops",
      images: [{ url: "https://alfarukhan.my.id/artwork1.jpg", height: 640, width: 640 }],
      tracks: { total: mockTrackData.tracks.items.length },
      owner: { id: "demo_user", display_name: "Demo User" },
      external_urls: { spotify: `https://open.spotify.com/playlist/${id}` }
    };

    res.json({
      success: true,
      data: mockPlaylist,
    });
    return;
  }

  try {
    const token = await getSpotifyToken();
    
    const response = await axios.get(`https://api.spotify.com/v1/playlists/${id}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
      params: {
        market: 'ID',
        fields: 'id,name,description,images,tracks.total,owner,external_urls'
      },
    });

    res.json({
      success: true,
      data: response.data,
    });
  } catch (error) {
    console.error('❌ Spotify playlist error:', error.response?.data || error.message);
    throw new AppError('Failed to get playlist details', 500);
  }
}));

// @route   GET /api/spotify/daily-drop
// @desc    Get daily drop track from Spotify playlists (for iframe player integration)
// @access  Private
router.get('/daily-drop', authMiddleware, asyncHandler(async (req, res) => {
  console.log('🎵 Getting daily drop from Spotify...');
  const { playlistId } = req.query;

  // Predefined playlists for daily drops (for iframe integration)
  const dailyDropPlaylists = [
    '7MieF1YXYq0OtVxEc9FLW1', // User's first example playlist
    '7GI5lkW7vR4T4MGENfokkc', // User's second example playlist
  ];

  if (isDemoMode) {
    console.log('🎵 Using demo data for daily drop');
    const demoTrack = mockTrackData.tracks.items[0];
    
    const dailyDrop = {
      id: `daily_${demoTrack.id}`,
      artistName: demoTrack.artists[0].name,
      artistImageUrl: demoTrack.album.images[0]?.url || 'https://alfarukhan.my.id/artwork1.jpg',
      track: {
        id: demoTrack.id,
        name: demoTrack.name,
        artist: demoTrack.artists[0].name,
        albumImageUrl: demoTrack.album.images[0]?.url || 'https://alfarukhan.my.id/artwork1.jpg',
        previewUrl: demoTrack.preview_url || '',
        spotifyUrl: demoTrack.external_urls.spotify,
        durationMs: demoTrack.duration_ms,
      },
      playlistId: playlistId || dailyDropPlaylists[0],
      playlistName: "Demo Daily Drop Playlist",
      playlistUrl: `https://open.spotify.com/playlist/${playlistId || dailyDropPlaylists[0]}`,
      date: new Date().toISOString(),
      isActive: true,
    };

    return res.json({
      success: true,
      data: dailyDrop,
    });
  }

  try {
    const token = await getSpotifyToken();
    
    // Use specific playlist if provided, otherwise pick from predefined list
    const targetPlaylistId = playlistId || dailyDropPlaylists[Math.floor(Math.random() * dailyDropPlaylists.length)];
    
    // Get playlist details
    const playlistResponse = await axios.get(
      `https://api.spotify.com/v1/playlists/${targetPlaylistId}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        params: {
          market: 'ID',
          fields: 'id,name,description,images,external_urls'
        }
      }
    );

    const playlist = playlistResponse.data;

    // Get tracks from the selected playlist
    const playlistTracksResponse = await axios.get(
      `https://api.spotify.com/v1/playlists/${targetPlaylistId}/tracks`,
      {
        headers: { Authorization: `Bearer ${token}` },
        params: {
          limit: 50,
          market: 'ID',
          fields: 'items(track(id,name,artists,album,duration_ms,preview_url,external_urls,popularity))'
        }
      }
    );

    // Filter tracks with preview URLs and pick a random one
    const tracks = playlistTracksResponse.data.items
      .filter(item => item.track && item.track.preview_url && item.track.id)
      .map(item => item.track);

    if (tracks.length === 0) {
      throw new AppError('No suitable tracks found in playlist', 404);
    }

    const selectedTrack = tracks[Math.floor(Math.random() * tracks.length)];

    // Format as DailyDrop with playlist information
    const dailyDrop = {
      id: `daily_${selectedTrack.id}`,
      artistName: selectedTrack.artists[0]?.name || 'Unknown Artist',
      artistImageUrl: selectedTrack.album.images[0]?.url || selectedTrack.artists[0]?.images?.[0]?.url || '',
      track: {
        id: selectedTrack.id,
        name: selectedTrack.name,
        artist: selectedTrack.artists[0]?.name || 'Unknown Artist',
        albumImageUrl: selectedTrack.album.images[0]?.url || '',
        previewUrl: selectedTrack.preview_url || '',
        spotifyUrl: selectedTrack.external_urls.spotify,
        durationMs: selectedTrack.duration_ms,
      },
      playlistId: targetPlaylistId,
      playlistName: playlist.name,
      playlistUrl: playlist.external_urls.spotify,
      playlistImageUrl: playlist.images[0]?.url || '',
      date: new Date().toISOString(),
      isActive: true,
    };

    console.log(`✅ Daily drop selected: ${dailyDrop.track.name} by ${dailyDrop.artistName}`);

    res.json({
      success: true,
      data: dailyDrop,
    });

  } catch (error) {
    console.error('❌ Error getting daily drop:', error.message);
    
    // Fallback to demo data on error
    const demoTrack = mockTrackData.tracks.items[0];
    const dailyDrop = {
      id: `daily_${demoTrack.id}`,
      artistName: demoTrack.artists[0].name,
      artistImageUrl: demoTrack.album.images[0]?.url || 'https://alfarukhan.my.id/artwork1.jpg',
      track: {
        id: demoTrack.id,
        name: demoTrack.name,
        artist: demoTrack.artists[0].name,
        albumImageUrl: demoTrack.album.images[0]?.url || 'https://alfarukhan.my.id/artwork1.jpg',
        previewUrl: demoTrack.preview_url || '',
        spotifyUrl: demoTrack.external_urls.spotify,
        durationMs: demoTrack.duration_ms,
      },
      playlistId: playlistId || dailyDropPlaylists[0],
      playlistName: "Fallback Daily Drop Playlist",
      playlistUrl: `https://open.spotify.com/playlist/${playlistId || dailyDropPlaylists[0]}`,
      date: new Date().toISOString(),
      isActive: true,
    };

    res.json({
      success: true,
      data: dailyDrop,
    });
  }
}));

module.exports = router;