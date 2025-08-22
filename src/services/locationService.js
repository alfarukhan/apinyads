/**
 * 📍 BACKEND LOCATION SERVICE (Path-style)
 * Secure Google Places API integration on server-side
 * No API keys exposed to client! 🔒
 */

class LocationService {
  constructor() {
    this.apiKey = process.env.GOOGLE_PLACES_API_KEY;
    this.baseUrl = 'https://maps.googleapis.com/maps/api/place';
    
    if (!this.apiKey || this.apiKey === 'YOUR_GOOGLE_PLACES_API_KEY') {
      console.warn('⚠️  Google Places API key not configured in environment variables');
    }
  }

  /**
   * 🎯 GET CURRENT LOCATION INFO
   * Reverse geocoding from coordinates to place info
   */
  async getCurrentLocationInfo(latitude, longitude) {
    try {
      console.log(`📍 Getting location info for: ${latitude}, ${longitude}`);

      const url = `${this.baseUrl}/nearbysearch/json` +
        `?location=${latitude},${longitude}` +
        `&radius=50` + // Very small radius for current location
        `&key=${this.apiKey}`;

      const response = await fetch(url);
      const data = await response.json();

      if (data.status === 'OK' && data.results.length > 0) {
        const place = data.results[0];
        
        return {
          placeId: place.place_id,
          latitude: parseFloat(latitude),
          longitude: parseFloat(longitude),
          name: place.name || 'Current Location',
          address: place.vicinity || '',
          type: 'current_location',
          rating: place.rating,
          photoReference: place.photos?.[0]?.photo_reference,
          types: place.types || [],
        };
      }

      // Fallback if no nearby places
      return {
        latitude: parseFloat(latitude),
        longitude: parseFloat(longitude),
        name: 'Current Location',
        address: 'Your Location',
        type: 'current_location',
      };
    } catch (error) {
      console.error('❌ Error getting current location info:', error);
      throw new Error('Unable to get location information');
    }
  }

  /**
   * 🏢 SEARCH NEARBY PLACES (Path-style)
   */
  async searchNearbyPlaces(latitude, longitude, options = {}) {
    try {
      const {
        radius = 1000, // 1km default like Path
        keyword = '',
        type = '',
        maxResults = 20
      } = options;

      console.log(`🔍 Searching nearby places: ${keyword || 'all'} within ${radius}m`);

      let url = `${this.baseUrl}/nearbysearch/json` +
        `?location=${latitude},${longitude}` +
        `&radius=${radius}` +
        `&key=${this.apiKey}`;

      // Add filters
      if (type && type !== 'all') {
        url += `&type=${type}`;
      }
      
      if (keyword) {
        url += `&keyword=${encodeURIComponent(keyword)}`;
      }

      const response = await fetch(url);
      const data = await response.json();

      if (data.status === 'OK') {
        const places = data.results.map(place => ({
          placeId: place.place_id,
          latitude: place.geometry.location.lat,
          longitude: place.geometry.location.lng,
          name: place.name,
          address: place.vicinity || '',
          type: 'venue',
          rating: place.rating,
          photoReference: place.photos?.[0]?.photo_reference,
          priceLevel: place.price_level,
          types: place.types || [],
          isOpen: place.opening_hours?.open_now,
          userRatingsTotal: place.user_ratings_total,
        }));

        // Sort by rating (Path-style)
        places.sort((a, b) => (b.rating || 0) - (a.rating || 0));

        console.log(`✅ Found ${places.length} nearby places`);
        return places.slice(0, maxResults);
      }

      console.log(`⚠️  Places API returned: ${data.status}`);
      return [];
    } catch (error) {
      console.error('❌ Error searching nearby places:', error);
      throw new Error('Unable to search nearby places');
    }
  }

  /**
   * 🔥 GET POPULAR PLACES (Path-style trending spots)
   */
  async getPopularPlaces(latitude, longitude, options = {}) {
    try {
      const {
        radius = 5000, // 5km for popular spots
        maxResults = 15
      } = options;

      console.log(`🔥 Getting popular places within ${radius}m`);

      const url = `${this.baseUrl}/nearbysearch/json` +
        `?location=${latitude},${longitude}` +
        `&radius=${radius}` +
        `&type=point_of_interest` +
        `&key=${this.apiKey}`;

      const response = await fetch(url);
      const data = await response.json();

      if (data.status === 'OK') {
        let places = data.results.map(place => ({
          placeId: place.place_id,
          latitude: place.geometry.location.lat,
          longitude: place.geometry.location.lng,
          name: place.name,
          address: place.vicinity || '',
          type: 'popular_venue',
          rating: place.rating,
          photoReference: place.photos?.[0]?.photo_reference,
          priceLevel: place.price_level,
          types: place.types || [],
          isOpen: place.opening_hours?.open_now,
          userRatingsTotal: place.user_ratings_total,
        }));

        // Filter for popular places (high rating + many reviews)
        places = places.filter(place => 
          (place.rating || 0) >= 4.0 && 
          (place.userRatingsTotal || 0) >= 50
        );

        // Sort by popularity score (rating * review count)
        places.sort((a, b) => {
          const scoreA = (a.rating || 0) * (a.userRatingsTotal || 0);
          const scoreB = (b.rating || 0) * (b.userRatingsTotal || 0);
          return scoreB - scoreA;
        });

        console.log(`🔥 Found ${places.length} popular places`);
        return places.slice(0, maxResults);
      }

      return [];
    } catch (error) {
      console.error('❌ Error getting popular places:', error);
      throw new Error('Unable to get popular places');
    }
  }

  /**
   * 📸 GET PLACE PHOTO URL
   */
  getPlacePhotoUrl(photoReference, maxWidth = 400) {
    if (!photoReference) return null;
    
    return `${this.baseUrl}/photo` +
      `?maxwidth=${maxWidth}` +
      `&photo_reference=${photoReference}` +
      `&key=${this.apiKey}`;
  }

  /**
   * 🏃‍♂️ CALCULATE DISTANCE
   */
  calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // Earth's radius in meters
    const φ1 = lat1 * Math.PI/180;
    const φ2 = lat2 * Math.PI/180;
    const Δφ = (lat2-lat1) * Math.PI/180;
    const Δλ = (lon2-lon1) * Math.PI/180;

    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ/2) * Math.sin(Δλ/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

    return R * c; // Distance in meters
  }

  /**
   * 📏 FORMAT DISTANCE STRING
   */
  formatDistance(distanceInMeters) {
    if (distanceInMeters < 1000) {
      return `${Math.round(distanceInMeters)}m away`;
    } else {
      const distanceInKm = distanceInMeters / 1000;
      return `${distanceInKm.toFixed(1)}km away`;
    }
  }

  /**
   * 🏷️ GET PLACE CATEGORY
   */
  getPlaceCategory(types) {
    if (!types || !Array.isArray(types)) return '';
    
    if (types.includes('restaurant')) return 'Restaurant';
    if (types.includes('cafe')) return 'Cafe';
    if (types.includes('bar')) return 'Bar';
    if (types.includes('shopping_mall')) return 'Shopping';
    if (types.includes('tourist_attraction')) return 'Attraction';
    if (types.includes('park')) return 'Park';
    if (types.includes('gym')) return 'Gym';
    
    return 'Place';
  }

  /**
   * 💵 GET PRICE LEVEL STRING
   */
  getPriceString(priceLevel) {
    switch (priceLevel) {
      case 1: return '$';
      case 2: return '$$';
      case 3: return '$$$';
      case 4: return '$$$$';
      default: return '';
    }
  }

  /**
   * 🔍 GEOCODE ADDRESS TO COORDINATES
   * Convert address string to latitude/longitude
   */
  async geocodeAddress(address) {
    try {
      console.log(`🔍 Geocoding address: ${address}`);

      const url = `https://maps.googleapis.com/maps/api/geocode/json` +
        `?address=${encodeURIComponent(address)}` +
        `&key=${this.apiKey}`;

      const response = await fetch(url);
      const data = await response.json();

      if (data.status === 'OK' && data.results.length > 0) {
        const result = data.results[0];
        const location = result.geometry.location;
        
        return {
          latitude: location.lat,
          longitude: location.lng,
          formattedAddress: result.formatted_address,
          placeId: result.place_id,
          addressComponents: result.address_components,
          types: result.types || [],
        };
      } else {
        throw new Error(`Geocoding failed: ${data.status}`);
      }
    } catch (error) {
      console.error('❌ Error geocoding address:', error);
      throw new Error('Unable to geocode address');
    }
  }

  /**
   * 🏠 REVERSE GEOCODE COORDINATES TO ADDRESS
   * Convert latitude/longitude to formatted address
   */
  async reverseGeocode(latitude, longitude) {
    try {
      console.log(`🏠 Reverse geocoding: ${latitude}, ${longitude}`);

      const url = `https://maps.googleapis.com/maps/api/geocode/json` +
        `?latlng=${latitude},${longitude}` +
        `&key=${this.apiKey}`;

      const response = await fetch(url);
      const data = await response.json();

      if (data.status === 'OK' && data.results.length > 0) {
        const result = data.results[0];
        
        return {
          latitude: parseFloat(latitude),
          longitude: parseFloat(longitude),
          formattedAddress: result.formatted_address,
          placeId: result.place_id,
          addressComponents: result.address_components,
          types: result.types || [],
        };
      } else {
        throw new Error(`Reverse geocoding failed: ${data.status}`);
      }
    } catch (error) {
      console.error('❌ Error reverse geocoding:', error);
      throw new Error('Unable to reverse geocode coordinates');
    }
  }

  /**
   * 🗺️ GET STATIC MAP URL
   * Generate static map image URL with API key
   */
  getStaticMapUrl(latitude, longitude, options = {}) {
    const {
      zoom = 15,
      size = '600x320',
      mapType = 'roadmap',
      markerColor = 'red'
    } = options;

    const baseUrl = 'https://maps.googleapis.com/maps/api/staticmap';
    const params = new URLSearchParams({
      center: `${latitude},${longitude}`,
      zoom: zoom.toString(),
      size,
      maptype: mapType,
      markers: `color:${markerColor}|${latitude},${longitude}`,
      style: 'feature:poi|element:labels|visibility:off',
      key: this.apiKey
    });

    return `${baseUrl}?${params.toString()}`;
  }

  /**
   * ✅ CHECK API KEY CONFIGURATION
   */
  isConfigured() {
    return this.apiKey && this.apiKey !== 'YOUR_GOOGLE_PLACES_API_KEY';
  }
}

module.exports = new LocationService();