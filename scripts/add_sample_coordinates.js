const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function addSampleCoordinates() {
  try {
    console.log('🔧 Adding sample coordinates to venues and events...');

    // Sample coordinates for Indonesian cities
    const sampleCoordinates = {
      'Jakarta': { lat: -6.2088, lng: 106.8456 },
      'Bandung': { lat: -6.9175, lng: 107.6191 },
      'Surabaya': { lat: -7.2575, lng: 112.7521 },
      'Bali': { lat: -8.4095, lng: 115.1889 },
      'Yogyakarta': { lat: -7.7956, lng: 110.3695 },
      'Medan': { lat: 3.5952, lng: 98.6722 },
      'Denpasar': { lat: -8.6500, lng: 115.2167 }
    };

    // Update venues with coordinates
    const venues = await prisma.venue.findMany({
      where: {
        OR: [
          { latitude: null },
          { longitude: null },
          { latitude: 0 },
          { longitude: 0 }
        ]
      }
    });

    console.log(`📍 Found ${venues.length} venues without valid coordinates`);

    for (const venue of venues) {
      // Try to match venue location with sample coordinates
      let coordinates = null;
      
      for (const [city, coords] of Object.entries(sampleCoordinates)) {
        if (venue.location && venue.location.toLowerCase().includes(city.toLowerCase())) {
          coordinates = coords;
          break;
        }
      }

      // If no match found, use Jakarta as default
      if (!coordinates) {
        coordinates = sampleCoordinates['Jakarta'];
        console.log(`📍 Using Jakarta coordinates for venue: ${venue.name}`);
      } else {
        console.log(`📍 Matched ${venue.name} with coordinates for ${Object.keys(sampleCoordinates).find(city => 
          venue.location.toLowerCase().includes(city.toLowerCase())
        )}`);
      }

      await prisma.venue.update({
        where: { id: venue.id },
        data: {
          latitude: coordinates.lat,
          longitude: coordinates.lng
        }
      });
    }

    // Update events with coordinates
    const events = await prisma.event.findMany({
      where: {
        OR: [
          { latitude: null },
          { longitude: null },
          { latitude: 0 },
          { longitude: 0 }
        ]
      }
    });

    console.log(`📍 Found ${events.length} events without valid coordinates`);

    for (const event of events) {
      // Try to match event location with sample coordinates
      let coordinates = null;
      
      for (const [city, coords] of Object.entries(sampleCoordinates)) {
        if (event.location && event.location.toLowerCase().includes(city.toLowerCase())) {
          coordinates = coords;
          break;
        }
      }

      // If no match found, use Jakarta as default
      if (!coordinates) {
        coordinates = sampleCoordinates['Jakarta'];
        console.log(`📍 Using Jakarta coordinates for event: ${event.title}`);
      } else {
        console.log(`📍 Matched ${event.title} with coordinates for ${Object.keys(sampleCoordinates).find(city => 
          event.location.toLowerCase().includes(city.toLowerCase())
        )}`);
      }

      await prisma.event.update({
        where: { id: event.id },
        data: {
          latitude: coordinates.lat,
          longitude: coordinates.lng
        }
      });
    }

    console.log('✅ Sample coordinates added successfully!');
    
    // Verify the updates
    const updatedVenues = await prisma.venue.findMany({
      where: {
        AND: [
          { latitude: { not: null } },
          { longitude: { not: null } },
          { latitude: { not: 0 } },
          { longitude: { not: 0 } }
        ]
      },
      select: { id: true, name: true, latitude: true, longitude: true }
    });

    const updatedEvents = await prisma.event.findMany({
      where: {
        AND: [
          { latitude: { not: null } },
          { longitude: { not: null } },
          { latitude: { not: 0 } },
          { longitude: { not: 0 } }
        ]
      },
      select: { id: true, title: true, latitude: true, longitude: true }
    });

    console.log(`✅ Verification: ${updatedVenues.length} venues now have valid coordinates`);
    console.log(`✅ Verification: ${updatedEvents.length} events now have valid coordinates`);

    if (updatedVenues.length > 0) {
      console.log('📍 Sample venue coordinates:');
      updatedVenues.slice(0, 3).forEach(venue => {
        console.log(`  - ${venue.name}: ${venue.latitude}, ${venue.longitude}`);
      });
    }

    if (updatedEvents.length > 0) {
      console.log('📍 Sample event coordinates:');
      updatedEvents.slice(0, 3).forEach(event => {
        console.log(`  - ${event.title}: ${event.latitude}, ${event.longitude}`);
      });
    }

  } catch (error) {
    console.error('❌ Error adding sample coordinates:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the script
addSampleCoordinates();