/**
 * 📍 LOCATION ROUTES (Path-style)
 * Secure backend endpoints for location services
 * API keys safely stored on server! 🔒
 */

const express = require('express');
const router = express.Router();
const Joi = require('joi');
const locationService = require('../services/locationService');
const { authMiddleware } = require('../middleware/auth');
const rateLimit = require('express-rate-limit');

// Rate limiting for location endpoints
const locationRateLimit = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 30, // Limit each IP to 30 requests per windowMs
  message: {
    error: 'Too many location requests, please try again later.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Validation schemas
const coordinatesSchema = Joi.object({
  latitude: Joi.number().min(-90).max(90).required(),
  longitude: Joi.number().min(-180).max(180).required(),
});

const nearbySearchSchema = coordinatesSchema.keys({
  radius: Joi.number().min(100).max(50000).default(1000), // 100m to 50km
  keyword: Joi.string().max(100).allow('').default(''),
  type: Joi.string().valid(
    'all', 'restaurant', 'cafe', 'bar', 'shopping_mall', 
    'movie_theater', 'gas_station', 'hospital', 'pharmacy',
    'bank', 'atm', 'tourist_attraction', 'park', 'gym'
  ).default('all'),
  maxResults: Joi.number().min(1).max(50).default(20),
});

const popularSearchSchema = coordinatesSchema.keys({
  radius: Joi.number().min(1000).max(50000).default(5000), // 1km to 50km for popular
  maxResults: Joi.number().min(1).max(25).default(15),
});

/**
 * 📍 GET CURRENT LOCATION INFO
 * POST /api/location/current
 * Body: { latitude, longitude }
 */
router.post('/current', 
  locationRateLimit,
  authMiddleware,
  async (req, res) => {
    try {
      console.log('📍 API: Getting current location info');

      // Validate coordinates
      const { error, value } = coordinatesSchema.validate(req.body);
      if (error) {
        return res.status(400).json({
          success: false,
          message: 'Invalid coordinates',
          error: error.details[0].message,
        });
      }

      const { latitude, longitude } = value;

      // Check if API is configured
      if (!locationService.isConfigured()) {
        return res.status(503).json({
          success: false,
          message: 'Location service not configured',
          error: 'Google Places API key not set up',
        });
      }

      const locationInfo = await locationService.getCurrentLocationInfo(latitude, longitude);

      res.json({
        success: true,
        data: {
          ...locationInfo,
          category: locationService.getPlaceCategory(locationInfo.types),
          priceString: locationService.getPriceString(locationInfo.priceLevel),
          photoUrl: locationInfo.photoReference 
            ? locationService.getPlacePhotoUrl(locationInfo.photoReference)
            : null,
        },
      });

    } catch (error) {
      console.error('❌ Error in current location endpoint:', error);
      res.status(500).json({
        success: false,
        message: 'Unable to get current location info',
        error: error.message,
      });
    }
  }
);

/**
 * 🏢 SEARCH NEARBY PLACES
 * POST /api/location/nearby
 * Body: { latitude, longitude, radius?, keyword?, type?, maxResults? }
 */
router.post('/nearby',
  locationRateLimit,
  authMiddleware,
  async (req, res) => {
    try {
      console.log('🏢 API: Searching nearby places');

      // Validate request
      const { error, value } = nearbySearchSchema.validate(req.body);
      if (error) {
        return res.status(400).json({
          success: false,
          message: 'Invalid search parameters',
          error: error.details[0].message,
        });
      }

      const { latitude, longitude, radius, keyword, type, maxResults } = value;

      // Check if API is configured
      if (!locationService.isConfigured()) {
        return res.status(503).json({
          success: false,
          message: 'Location service not configured',
          error: 'Google Places API key not set up',
        });
      }

      const places = await locationService.searchNearbyPlaces(latitude, longitude, {
        radius,
        keyword,
        type: type === 'all' ? '' : type,
        maxResults,
      });

      // Enhance places with additional info and distance
      const enhancedPlaces = places.map(place => ({
        ...place,
        category: locationService.getPlaceCategory(place.types),
        priceString: locationService.getPriceString(place.priceLevel),
        photoUrl: place.photoReference 
          ? locationService.getPlacePhotoUrl(place.photoReference)
          : null,
        distance: locationService.formatDistance(
          locationService.calculateDistance(latitude, longitude, place.latitude, place.longitude)
        ),
      }));

      res.json({
        success: true,
        data: enhancedPlaces,
        metadata: {
          searchCenter: { latitude, longitude },
          radius,
          keyword,
          type,
          count: enhancedPlaces.length,
        },
      });

    } catch (error) {
      console.error('❌ Error in nearby places endpoint:', error);
      res.status(500).json({
        success: false,
        message: 'Unable to search nearby places',
        error: error.message,
      });
    }
  }
);

/**
 * 🔥 GET POPULAR PLACES
 * POST /api/location/popular
 * Body: { latitude, longitude, radius?, maxResults? }
 */
router.post('/popular',
  locationRateLimit,
  authMiddleware,
  async (req, res) => {
    try {
      console.log('🔥 API: Getting popular places');

      // Validate request
      const { error, value } = popularSearchSchema.validate(req.body);
      if (error) {
        return res.status(400).json({
          success: false,
          message: 'Invalid search parameters',
          error: error.details[0].message,
        });
      }

      const { latitude, longitude, radius, maxResults } = value;

      // Check if API is configured
      if (!locationService.isConfigured()) {
        return res.status(503).json({
          success: false,
          message: 'Location service not configured',
          error: 'Google Places API key not set up',
        });
      }

      const places = await locationService.getPopularPlaces(latitude, longitude, {
        radius,
        maxResults,
      });

      // Enhance places with additional info and distance
      const enhancedPlaces = places.map(place => ({
        ...place,
        category: locationService.getPlaceCategory(place.types),
        priceString: locationService.getPriceString(place.priceLevel),
        photoUrl: place.photoReference 
          ? locationService.getPlacePhotoUrl(place.photoReference)
          : null,
        distance: locationService.formatDistance(
          locationService.calculateDistance(latitude, longitude, place.latitude, place.longitude)
        ),
      }));

      res.json({
        success: true,
        data: enhancedPlaces,
        metadata: {
          searchCenter: { latitude, longitude },
          radius,
          count: enhancedPlaces.length,
          criteria: 'High rating (4.0+) and many reviews (50+)',
        },
      });

    } catch (error) {
      console.error('❌ Error in popular places endpoint:', error);
      res.status(500).json({
        success: false,
        message: 'Unable to get popular places',
        error: error.message,
      });
    }
  }
);

/**
 * 📸 GET PLACE PHOTO
 * GET /api/location/photo/:photoReference
 * Query: ?maxWidth=400
 */
router.get('/photo/:photoReference',
  locationRateLimit,
  authMiddleware,
  async (req, res) => {
    try {
      const { photoReference } = req.params;
      const maxWidth = parseInt(req.query.maxWidth) || 400;

      if (!photoReference) {
        return res.status(400).json({
          success: false,
          message: 'Photo reference is required',
        });
      }

      // Check if API is configured
      if (!locationService.isConfigured()) {
        return res.status(503).json({
          success: false,
          message: 'Location service not configured',
        });
      }

      const photoUrl = locationService.getPlacePhotoUrl(photoReference, maxWidth);

      res.json({
        success: true,
        data: {
          photoUrl,
          photoReference,
          maxWidth,
        },
      });

    } catch (error) {
      console.error('❌ Error in photo endpoint:', error);
      res.status(500).json({
        success: false,
        message: 'Unable to get photo URL',
        error: error.message,
      });
    }
  }
);

/**
 * 🔍 GEOCODE ADDRESS TO COORDINATES
 * POST /api/location/geocode
 * Body: { address }
 */
router.post('/geocode',
  locationRateLimit,
  authMiddleware,
  async (req, res) => {
    try {
      console.log('🔍 API: Geocoding address');

      const { address } = req.body;
      if (!address || typeof address !== 'string') {
        return res.status(400).json({
          success: false,
          message: 'Address is required',
        });
      }

      // Check if API is configured
      if (!locationService.isConfigured()) {
        return res.status(503).json({
          success: false,
          message: 'Location service not configured',
          error: 'Google Places API key not set up',
        });
      }

      const result = await locationService.geocodeAddress(address);

      res.json({
        success: true,
        data: result,
      });

    } catch (error) {
      console.error('❌ Error in geocode endpoint:', error);
      res.status(500).json({
        success: false,
        message: 'Unable to geocode address',
        error: error.message,
      });
    }
  }
);

/**
 * 🏠 REVERSE GEOCODE COORDINATES TO ADDRESS
 * POST /api/location/reverse-geocode
 * Body: { latitude, longitude }
 */
router.post('/reverse-geocode',
  locationRateLimit,
  authMiddleware,
  async (req, res) => {
    try {
      console.log('🏠 API: Reverse geocoding coordinates');

      // Validate coordinates
      const { error, value } = coordinatesSchema.validate(req.body);
      if (error) {
        return res.status(400).json({
          success: false,
          message: 'Invalid coordinates',
          error: error.details[0].message,
        });
      }

      const { latitude, longitude } = value;

      // Check if API is configured
      if (!locationService.isConfigured()) {
        return res.status(503).json({
          success: false,
          message: 'Location service not configured',
          error: 'Google Places API key not set up',
        });
      }

      const result = await locationService.reverseGeocode(latitude, longitude);

      res.json({
        success: true,
        data: result,
      });

    } catch (error) {
      console.error('❌ Error in reverse geocode endpoint:', error);
      res.status(500).json({
        success: false,
        message: 'Unable to reverse geocode coordinates',
        error: error.message,
      });
    }
  }
);

/**
 * 🗺️ GET STATIC MAP IMAGE
 * GET /api/location/static-map
 * Query: ?lat=x&lng=y&zoom=15&size=600x320
 */
router.get('/static-map',
  locationRateLimit,
  authMiddleware,
  async (req, res) => {
    try {
      const { lat, lng, zoom = 15, size = '600x320' } = req.query;

      if (!lat || !lng) {
        return res.status(400).json({
          success: false,
          message: 'Latitude and longitude are required',
        });
      }

      // Check if API is configured
      if (!locationService.isConfigured()) {
        return res.status(503).json({
          success: false,
          message: 'Location service not configured',
        });
      }

      const mapUrl = locationService.getStaticMapUrl(
        parseFloat(lat), 
        parseFloat(lng), 
        { zoom: parseInt(zoom), size }
      );

      res.json({
        success: true,
        data: {
          mapUrl,
          coordinates: {
            latitude: parseFloat(lat),
            longitude: parseFloat(lng),
          },
          zoom: parseInt(zoom),
          size,
        },
      });

    } catch (error) {
      console.error('❌ Error in static map endpoint:', error);
      res.status(500).json({
        success: false,
        message: 'Unable to generate map image',
        error: error.message,
      });
    }
  }
);

/**
 * 🔧 HEALTH CHECK
 * GET /api/location/health
 */
router.get('/health', (req, res) => {
  const isConfigured = locationService.isConfigured();
  
  res.json({
    success: true,
    service: 'Location Service',
    status: isConfigured ? 'ready' : 'not_configured',
    message: isConfigured 
      ? 'Google Places API is configured and ready'
      : 'Google Places API key not configured',
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;