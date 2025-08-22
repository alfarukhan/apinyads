const express = require('express');
const axios = require('axios');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// @route   GET /api/music/search
// @desc    Search songs via iTunes Search API (no auth required)
// @access  Private (proxy through our server for consistency/rate limiting)
router.get('/search', authMiddleware, asyncHandler(async (req, res) => {
  const { q } = req.query;
  let { limit = 30, country = 'US' } = req.query;
  if (!q) throw new AppError('Search query is required', 400);

  // Sanitize inputs
  const parsedLimit = Math.max(1, Math.min(parseInt(limit, 10) || 5, 25));
  const countryCode = String(country).toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2) || 'US';

  try {
    const params = {
      term: q,
      media: 'music',
      entity: 'song',
      limit: parsedLimit,
      country: countryCode,
    };

    // Helper to perform a request with certain headers and normalize the response
    const doRequest = async (headers) => {
      const resp = await axios.get('https://itunes.apple.com/search', {
        params,
        responseType: 'text',
        headers,
        timeout: 7000,
        validateStatus: (status) => status >= 200 && status < 500,
      });

      const ct = String(resp.headers?.['content-type'] || '');
      if (ct.includes('application/json')) {
        return typeof resp.data === 'string' ? JSON.parse(resp.data) : resp.data;
      }

      // Some Apple edges return HTML but body still contains JSON string
      if (typeof resp.data === 'string') {
        const text = resp.data.trim();
        if (text.startsWith('{') && text.endsWith('}')) {
          try { return JSON.parse(text); } catch (_) {}
        }
      }
      return null;
    };

    // Attempt 1: Chrome UA + Accept-Language + Referer
    const headers1 = {
      'Accept': 'application/json',
      'Accept-Language': 'en-US,en;q=0.9',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      'Origin': 'https://music.apple.com',
      'Referer': 'https://music.apple.com/',
    };
    let data = await doRequest(headers1);

    // Attempt 2: iOS Safari UA if first attempt failed
    if (!data) {
      const headers2 = {
        'Accept': 'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
        'Origin': 'https://music.apple.com',
        'Referer': 'https://music.apple.com/',
      };
      data = await doRequest(headers2);
    }

    if (!data || typeof data !== 'object' || !('results' in data)) {
      return res.json({ success: true, data: { results: [] } });
    }

    return res.json({ success: true, data });
  } catch (error) {
    console.error('❌ Apple music search error:', error.response?.data || error.message);
    // Return empty results instead of 500 to avoid user-facing errors
    return res.json({ success: true, data: { results: [] } });
  }
}));

module.exports = router;

