const express = require('express');
const { PrismaClient } = require('@prisma/client');
const router = express.Router();
// ✅ ENTERPRISE: Use centralized singleton
const { prisma } = require('../lib/prisma');

// ✅ ENTERPRISE: Use centralized user selectors
const userSelectors = require('../lib/user-selectors');

const asyncHandler = require('../middleware/asyncHandler');

// Get all cities with statistics
router.get('/', async (req, res) => {
  try {
    const { page = '1', limit = '50', country } = req.query;

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));

    // Get cities from artists, venues, and users
    const [artists, venues, events, users] = await Promise.all([
      prisma.artist.findMany({
        where: { isActive: true },
        select: { city: true, country: true }
      }),
      prisma.venue.findMany({
        where: { isActive: true },
        select: { location: true }
      }),
      prisma.event.findMany({
        where: { isActive: true },
        select: { location: true }
      }),
      prisma.user.findMany({
        where: { isActive: true },
        select: { city: true, country: true }
      })
    ]);

    // Count artists and events by city
    const cityStats = {};

    // Process artists
    artists.forEach(artist => {
      if (artist.city) {
        const cityKey = artist.city;
        if (!cityStats[cityKey]) {
          cityStats[cityKey] = {
            artistsCount: 0,
            eventsCount: 0,
            country: artist.country || 'Unknown'
          };
        }
        cityStats[cityKey].artistsCount++;
      }
    });

    // Process venues and events for event counts
    [...venues, ...events].forEach(item => {
      if (item.location) {
        // Extract city from location (assuming format like "City, Country" or just "City")
        const cityName = item.location.split(',')[0].trim();
        if (!cityStats[cityName]) {
          cityStats[cityName] = {
            artistsCount: 0,
            eventsCount: 0,
            country: 'Indonesia' // Default for our data
          };
        }
        cityStats[cityName].eventsCount++;
      }
    });

    // Filter by country if specified
    let filteredCities = Object.entries(cityStats);
    if (country) {
      filteredCities = filteredCities.filter(([_, stats]) => 
        stats.country.toLowerCase().includes(country.toLowerCase())
      );
    }

    // Convert to array and add metadata
    const cities = filteredCities
      .map(([name, stats]) => ({
        name,
        country: stats.country,
        artistsCount: stats.artistsCount,
        eventsCount: stats.eventsCount,
        imageUrl: getCityImageUrl(name),
        latitude: getCityCoordinates(name).lat,
        longitude: getCityCoordinates(name).lng,
        isPopular: stats.artistsCount + stats.eventsCount > 3
      }))
      .sort((a, b) => (b.artistsCount + b.eventsCount) - (a.artistsCount + a.eventsCount))
      .slice((pageNum - 1) * limitNum, pageNum * limitNum);

    const total = filteredCities.length;
    const totalPages = Math.ceil(total / limitNum);

    res.json({
      success: true,
      data: {
        cities,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages,
          hasNext: pageNum < totalPages,
          hasPrev: pageNum > 1
        }
      }
    });
  } catch (error) {
    console.error('Error fetching cities:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch cities',
      error: error.message
    });
  }
});

// Get available countries
router.get('/countries', async (req, res) => {
  try {
    const [artistCountries, userCountries] = await Promise.all([
      prisma.artist.findMany({
        where: { 
          isActive: true,
          country: { not: null }
        },
        select: { country: true },
        distinct: ['country']
      }),
      prisma.user.findMany({
        where: { 
          isActive: true,
          country: { not: null }
        },
        select: { country: true },
        distinct: ['country']
      })
    ]);

    const countries = Array.from(new Set([
      ...artistCountries.map(a => a.country),
      ...userCountries.map(u => u.country)
    ])).filter(Boolean).sort();

    res.json({
      success: true,
      data: { countries }
    });
  } catch (error) {
    console.error('Error fetching countries:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch countries',
      error: error.message
    });
  }
});

// Search cities
router.get('/search', async (req, res) => {
  try {
    const { q: query, limit = '20' } = req.query;

    if (!query || query.trim().length < 2) {
      return res.status(400).json({
        success: false,
        message: 'Search query must be at least 2 characters'
      });
    }

    const limitNum = Math.min(50, Math.max(1, parseInt(limit)));

    // Search in artists, venues, and events
    const [artists, venues, events] = await Promise.all([
      prisma.artist.findMany({
        where: {
          isActive: true,
          OR: [
            { city: { contains: query, mode: 'insensitive' } },
            { country: { contains: query, mode: 'insensitive' } }
          ]
        },
        select: { city: true, country: true }
      }),
      prisma.venue.findMany({
        where: {
          isActive: true,
          location: { contains: query, mode: 'insensitive' }
        },
        select: { location: true }
      }),
      prisma.event.findMany({
        where: {
          isActive: true,
          location: { contains: query, mode: 'insensitive' }
        },
        select: { location: true }
      })
    ]);

    const matchingCities = new Set();

    // Add matching cities from artists
    artists.forEach(artist => {
      if (artist.city && artist.city.toLowerCase().includes(query.toLowerCase())) {
        matchingCities.add(artist.city);
      }
    });

    // Add matching cities from venues and events
    [...venues, ...events].forEach(item => {
      if (item.location) {
        const cityName = item.location.split(',')[0].trim();
        if (cityName.toLowerCase().includes(query.toLowerCase())) {
          matchingCities.add(cityName);
        }
      }
    });

    const cities = Array.from(matchingCities).slice(0, limitNum).map(name => ({
      name,
      country: 'Indonesia', // Default
      imageUrl: getCityImageUrl(name),
      latitude: getCityCoordinates(name).lat,
      longitude: getCityCoordinates(name).lng
    }));

    res.json({
      success: true,
      data: { cities }
    });
  } catch (error) {
    console.error('Error searching cities:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to search cities',
      error: error.message
    });
  }
});

// Get artists by city
router.get('/:cityName/artists', async (req, res) => {
  try {
    const { cityName } = req.params;
    const { page = '1', limit = '20' } = req.query;

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(50, Math.max(1, parseInt(limit)));
    const skip = (pageNum - 1) * limitNum;

    const [artists, total] = await Promise.all([
      prisma.artist.findMany({
        where: {
          isActive: true,
          city: { equals: cityName, mode: 'insensitive' }
        },
        skip,
        take: limitNum,
        orderBy: { followersCount: 'desc' },
        select: {
          id: true,
          name: true,
          description: true,
          imageUrl: true,
          genres: true,
          country: true,
          city: true,
          isVerified: true,
          followersCount: true
        }
      }),
      prisma.artist.count({
        where: {
          isActive: true,
          city: { equals: cityName, mode: 'insensitive' }
        }
      })
    ]);

    const totalPages = Math.ceil(total / limitNum);

    res.json({
      success: true,
      data: {
        city: cityName,
        artists,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages,
          hasNext: pageNum < totalPages,
          hasPrev: pageNum > 1
        }
      }
    });
  } catch (error) {
    console.error('Error fetching artists by city:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch artists by city',
      error: error.message
    });
  }
});

// Get events by city
router.get('/:cityName/events', async (req, res) => {
  try {
    const { cityName } = req.params;
    const { page = '1', limit = '20' } = req.query;

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(50, Math.max(1, parseInt(limit)));
    const skip = (pageNum - 1) * limitNum;

    const [events, total] = await Promise.all([
      prisma.event.findMany({
        where: {
          isActive: true,
          location: { contains: cityName, mode: 'insensitive' }
        },
        skip,
        take: limitNum,
        orderBy: { startDate: 'asc' },
        include: {
          organizer: {
            select: {
              id: true,
              username: true,
              firstName: true,
              lastName: true
            }
          },
          venue: {
            select: {
              id: true,
              name: true,
              location: true
            }
          }
        }
      }),
      prisma.event.count({
        where: {
          isActive: true,
          location: { contains: cityName, mode: 'insensitive' }
        }
      })
    ]);

    const totalPages = Math.ceil(total / limitNum);

    res.json({
      success: true,
      data: {
        city: cityName,
        events,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages,
          hasNext: pageNum < totalPages,
          hasPrev: pageNum > 1
        }
      }
    });
  } catch (error) {
    console.error('Error fetching events by city:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch events by city',
      error: error.message
    });
  }
});

// @route   GET /api/cities/dynamic
// @desc    Get dynamic city list from existing events, venues, and artists
// @access  Public
router.get('/dynamic', async (req, res) => {
  try {
    console.log('🏙️ Getting dynamic cities from events, venues, and artists...');

    // Get all unique locations from events, venues, and artists
    const [eventLocations, venueLocations, artistCities] = await Promise.all([
      prisma.event.findMany({
        where: { isActive: true },
        select: { location: true },
        distinct: ['location']
      }),
      prisma.venue.findMany({
        where: { isActive: true },
        select: { location: true },
        distinct: ['location']
      }),
      prisma.artist.findMany({
        where: { isActive: true },
        select: { city: true, country: true },
        distinct: ['city']
      })
    ]);

    // Build city data with correct countries
    const cityMap = new Map();

    // Process events and venues (extract city names)
    const allLocations = [
      ...eventLocations.map(e => e.location),
      ...venueLocations.map(v => v.location)
    ];

    allLocations.forEach(location => {
      if (location) {
        const parts = location.split(',').map(part => part.trim());
        if (parts.length >= 2) {
          const city = parts[parts.length - 1];
          cityMap.set(city, 'Indonesia'); // Default to Indonesia for venues/events
        } else {
          // Handle cases like "Skylounge Bandung" -> extract just "Bandung"
          const words = parts[0].split(' ');
          const knownCities = ['Jakarta', 'Bandung', 'Surabaya', 'Yogyakarta', 'Bali', 'Semarang', 'Medan', 'Palembang', 'Tangerang'];
          const venueKeywords = ['Hall', 'Club', 'Lounge', 'Center', 'Studio', 'Arena', 'Venue', 'Hotel', 'Mall', 'City', 'Resort'];
          
          if (words.length > 1) {
            const lastWord = words[words.length - 1];
            if (knownCities.some(city => city.toLowerCase() === lastWord.toLowerCase())) {
              cityMap.set(lastWord, 'Indonesia');
            } else {
              const hasVenueKeyword = venueKeywords.some(keyword => 
                parts[0].toLowerCase().includes(keyword.toLowerCase())
              );
              
              if (!hasVenueKeyword) {
                cityMap.set(parts[0], 'Indonesia');
              }
            }
          } else {
            const isVenueKeyword = venueKeywords.some(keyword => 
              parts[0].toLowerCase() === keyword.toLowerCase()
            );
            if (!isVenueKeyword) {
              cityMap.set(parts[0], 'Indonesia');
            }
          }
        }
      }
    });

    // Process artists (use actual country data)
    artistCities.forEach(artist => {
      if (artist.city && artist.country) {
        cityMap.set(artist.city, artist.country);
      }
    });

    // Convert to array format with city and country
    const cities = Array.from(cityMap.entries())
      .filter(([city, country]) => city && city.length > 0)
      .map(([city, country]) => ({ name: city, country }))
      .sort((a, b) => a.name.localeCompare(b.name));

    console.log(`✅ Found ${cities.length} dynamic cities with countries`);
    cities.forEach(city => console.log(`  - ${city.name}, ${city.country}`));

    res.json({
      success: true,
      data: cities
    });
  } catch (error) {
    console.error('❌ Error fetching dynamic cities:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch dynamic cities',
      error: error.message
    });
  }
});

// @route   GET /api/cities/list
// @desc    Get list of cities for registration
// @access  Public
router.get('/list', asyncHandler(async (req, res) => {
  // Indonesian cities list for registration
  const cities = [
    'Jakarta', 'Surabaya', 'Medan', 'Bekasi', 'Bandung', 'Tangerang', 'Depok', 'Semarang', 
    'Palembang', 'Makassar', 'South Tangerang', 'Batam', 'Bogor', 'Pekanbaru', 'Bandar Lampung',
    'Malang', 'Padang', 'Yogyakarta', 'Samarinda', 'Denpasar', 'Balikpapan', 'Pontianak', 
    'Jambi', 'Surakarta', 'Cimahi', 'Manado', 'Serang', 'Mataram', 'Banjarbaru', 'Bengkulu',
    'Kediri', 'Ambon', 'Jayapura', 'Palu', 'Banda Aceh', 'Kupang', 'Pekalongan', 'Banjarmasin',
    'Ternate', 'Gorontalo', 'Salatiga', 'Lubuklinggau', 'Madiun', 'Probolinggo', 'Mojokerto',
    'Magelang', 'Bukittinggi', 'Pangkalpinang', 'Cilegon', 'Bitung', 'Singkawang', 'Lhokseumawe',
    'Langsa', 'Tegal', 'Tarakan', 'Bontang', 'Tasikmalaya', 'Batu', 'Padang Sidempuan',
    'Tebing Tinggi', 'Binjai', 'Pematangsiantar', 'Gunungsitoli', 'Dumai', 'Kendari',
    'Sorong', 'Baubau', 'Kotamobagu', 'Tomohon', 'Palangka Raya', 'Sampit', 'Watampone',
    'Parepare', 'Palopo', 'Bima', 'Tidore Kepulauan', 'Sofifi'
  ].sort();

  res.json({
    success: true,
    data: cities
  });
}));

// Helper functions
function getCityImageUrl(cityName) {
  const cityImages = {
    'Jakarta': 'https://alfarukhan.my.id/artwork1.jpg',
    'Bandung': 'https://alfarukhan.my.id/artwork2.jpg',
    'Surabaya': 'https://alfarukhan.my.id/artwork3.jpg',
    'Yogyakarta': 'https://alfarukhan.my.id/artwork4.jpg',
    'Bali': 'https://alfarukhan.my.id/artwork5.jpg',
    'Medan': 'https://alfarukhan.my.id/artwork6.jpg',
    'Semarang': 'https://alfarukhan.my.id/artwork7.jpg',
    'Makassar': 'https://alfarukhan.my.id/artwork8.jpg',
    'Malang': 'https://alfarukhan.my.id/artwork9.jpg',
    'Palembang': 'https://alfarukhan.my.id/artwork10.jpg'
  };
  return cityImages[cityName] || `https://alfarukhan.my.id/artwork${Math.floor(Math.random() * 10) + 1}.jpg`;
}

function getCityCoordinates(cityName) {
  const coordinates = {
    'Jakarta': { lat: -6.2088, lng: 106.8456 },
    'Bandung': { lat: -6.9175, lng: 107.6191 },
    'Surabaya': { lat: -7.2575, lng: 112.7521 },
    'Yogyakarta': { lat: -7.7956, lng: 110.3695 },
    'Bali': { lat: -8.4095, lng: 115.1889 },
    'Medan': { lat: 3.5952, lng: 98.6722 },
    'Semarang': { lat: -6.9666, lng: 110.4167 },
    'Makassar': { lat: -5.1477, lng: 119.4327 },
    'Malang': { lat: -7.9797, lng: 112.6304 },
    'Palembang': { lat: -2.9761, lng: 104.7754 }
  };
  return coordinates[cityName] || { lat: -6.2088, lng: 106.8456 }; // Default to Jakarta
}

module.exports = router;
module.exports = router;