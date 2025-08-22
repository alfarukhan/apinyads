#!/usr/bin/env node

/**
 * Comprehensive Artist Seed Script
 * Seeds database with detailed artist data including genres, locations, and social links
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Comprehensive artist data with real Indonesian and international electronic artists
const ARTIST_DATA = [
  // Indonesian Electronic Artists
  {
    name: 'Dipha Barus',
    description: 'Indonesian DJ and producer known for progressive house and electronic dance music. Based in Jakarta, he has performed at major festivals across Asia and is known for tracks like "No One Can Stop Us" and collaborations with international artists.',
    imageUrl: 'https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?w=400&h=400&fit=crop&crop=face',
    genres: ['Electronic', 'Progressive House', 'Deep House'],
    country: 'Indonesia',
    city: 'Jakarta',
    socialLinks: {
      spotify: 'https://open.spotify.com/artist/1234567890',
      instagram: 'https://instagram.com/diphabarus',
      soundcloud: 'https://soundcloud.com/diphabarus'
    },
    isVerified: true,
    followersCount: 85420
  },
  {
    name: 'Weird Genius',
    description: 'Indonesian electronic music trio consisting of Reza Oktovian, Eka Gustiwana, and Gerald. Known for blending electronic music with Indonesian cultural elements. Their hit "Lathi" featuring Sara Fajira went viral globally.',
    imageUrl: 'https://images.unsplash.com/photo-1556075798-4825dfaaf498?w=400&h=400&fit=crop&crop=face',
    genres: ['Electronic', 'Future Bass', 'Trap'],
    country: 'Indonesia',
    city: 'Jakarta',
    socialLinks: {
      spotify: 'https://open.spotify.com/artist/weirdgenius',
      instagram: 'https://instagram.com/weirdgeniusmusic',
      youtube: 'https://youtube.com/weirdgenius'
    },
    isVerified: true,
    followersCount: 120500
  },
  {
    name: 'Diskoria',
    description: 'Indonesian electronic music duo known for their indie electronic and synthwave sound. Based in Jakarta, they create nostalgic electronic music with modern twists.',
    imageUrl: 'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=400&h=400&fit=crop&crop=face',
    genres: ['Electronic', 'Synthwave', 'Indie Electronic'],
    country: 'Indonesia',
    city: 'Jakarta',
    socialLinks: {
      spotify: 'https://open.spotify.com/artist/diskoria',
      instagram: 'https://instagram.com/diskoria'
    },
    isVerified: true,
    followersCount: 45200
  },
  {
    name: 'Stars and Rabbit',
    description: 'Indonesian electronic music duo from Bandung known for their dreamy electronic soundscapes and ethereal vocals. They blend electronic music with indie pop elements.',
    imageUrl: 'https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?w=400&h=400&fit=crop&crop=face',
    genres: ['Electronic', 'Dream Pop', 'Indie Electronic'],
    country: 'Indonesia',
    city: 'Bandung',
    socialLinks: {
      spotify: 'https://open.spotify.com/artist/starsandrabbit',
      instagram: 'https://instagram.com/starsandrabbit'
    },
    isVerified: true,
    followersCount: 32800
  },
  {
    name: 'Matter Mos',
    description: 'Jakarta-based DJ and producer specializing in deep house and minimal techno. Known for atmospheric sets and underground electronic music scene contributions.',
    imageUrl: 'https://images.unsplash.com/photo-1572442388796-11668a67e53d?w=400&h=400&fit=crop&crop=face',
    genres: ['Deep House', 'Minimal Techno', 'Progressive House'],
    country: 'Indonesia',
    city: 'Jakarta',
    socialLinks: {
      soundcloud: 'https://soundcloud.com/mattermos',
      instagram: 'https://instagram.com/mattermos'
    },
    isVerified: false,
    followersCount: 18500
  },
  {
    name: 'Midnight Quickie',
    description: 'Indonesian electronic music project known for experimental electronic music and ambient soundscapes. Based in Jakarta with a focus on late-night electronic vibes.',
    imageUrl: 'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=400&h=400&fit=crop&crop=face',
    genres: ['Ambient', 'Experimental Electronic', 'Downtempo'],
    country: 'Indonesia',
    city: 'Jakarta',
    socialLinks: {
      bandcamp: 'https://midnightquickie.bandcamp.com',
      instagram: 'https://instagram.com/midnightquickie'
    },
    isVerified: false,
    followersCount: 12300
  },

  // International Electronic Artists
  {
    name: 'Calvin Harris',
    description: 'Scottish DJ, record producer, singer, and songwriter. One of the highest-paid DJs in the world, known for hits like "Feel So Close," "We Found Love," and collaborations with major pop artists.',
    imageUrl: 'https://images.unsplash.com/photo-1556075798-4825dfaaf498?w=400&h=400&fit=crop&crop=face',
    genres: ['Electronic', 'Progressive House', 'Electro House'],
    country: 'United Kingdom',
    city: 'London',
    socialLinks: {
      spotify: 'https://open.spotify.com/artist/calvinharris',
      instagram: 'https://instagram.com/calvinharris',
      twitter: 'https://twitter.com/calvinharris'
    },
    isVerified: true,
    followersCount: 2500000
  },
  {
    name: 'Martin Garrix',
    description: 'Dutch DJ and electronic music producer. Known for hits like "Animals," "Scared to be Lonely," and "In the Name of Love." One of the youngest DJs to reach #1 on DJ Mag\'s Top 100.',
    imageUrl: 'https://images.unsplash.com/photo-1572442388796-11668a67e53d?w=400&h=400&fit=crop&crop=face',
    genres: ['Progressive House', 'Big Room', 'Future Bass'],
    country: 'Netherlands',
    city: 'Amsterdam',
    socialLinks: {
      spotify: 'https://open.spotify.com/artist/martingarrix',
      instagram: 'https://instagram.com/martingarrix',
      youtube: 'https://youtube.com/martingarrix'
    },
    isVerified: true,
    followersCount: 3200000
  },
  {
    name: 'Deadmau5',
    description: 'Canadian electronic music producer and DJ known for his progressive house music and iconic mouse mask. Real name Joel Zimmerman, he\'s known for tracks like "Strobe" and "Ghosts \'n\' Stuff."',
    imageUrl: 'https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?w=400&h=400&fit=crop&crop=face',
    genres: ['Progressive House', 'Electro House', 'Techno'],
    country: 'Canada',
    city: 'Toronto',
    socialLinks: {
      spotify: 'https://open.spotify.com/artist/deadmau5',
      instagram: 'https://instagram.com/deadmau5',
      twitter: 'https://twitter.com/deadmau5'
    },
    isVerified: true,
    followersCount: 1800000
  },
  {
    name: 'Porter Robinson',
    description: 'American DJ, record producer, musician, and singer from North Carolina. Known for his emotional electronic music and live performances. Albums include "Worlds" and "Nurture."',
    imageUrl: 'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=400&h=400&fit=crop&crop=face',
    genres: ['Electronic', 'Future Bass', 'Melodic Dubstep'],
    country: 'United States',
    city: 'Los Angeles',
    socialLinks: {
      spotify: 'https://open.spotify.com/artist/porterrobinson',
      instagram: 'https://instagram.com/porterrobinson',
      twitter: 'https://twitter.com/porterrobinson'
    },
    isVerified: true,
    followersCount: 950000
  },
  {
    name: 'Flume',
    description: 'Australian record producer, musician and DJ known for his experimental electronic music. Real name Harley Edward Streten, he\'s known for tracks like "Never Be Like You" and "Say It."',
    imageUrl: 'https://images.unsplash.com/photo-1556075798-4825dfaaf498?w=400&h=400&fit=crop&crop=face',
    genres: ['Future Bass', 'Electronic', 'Experimental'],
    country: 'Australia',
    city: 'Sydney',
    socialLinks: {
      spotify: 'https://open.spotify.com/artist/flume',
      instagram: 'https://instagram.com/flume',
      soundcloud: 'https://soundcloud.com/flume'
    },
    isVerified: true,
    followersCount: 1200000
  },

  // More Indonesian Artists
  {
    name: 'Ramengvrl',
    description: 'Indonesian rapper and hip-hop artist known for her fierce rap style and electronic-influenced hip-hop tracks. Based in Jakarta, she\'s a prominent figure in Indonesian rap scene.',
    imageUrl: 'https://images.unsplash.com/photo-1572442388796-11668a67e53d?w=400&h=400&fit=crop&crop=face',
    genres: ['Hip Hop', 'Electronic', 'Trap'],
    country: 'Indonesia',
    city: 'Jakarta',
    socialLinks: {
      spotify: 'https://open.spotify.com/artist/ramengvrl',
      instagram: 'https://instagram.com/ramengvrl',
      youtube: 'https://youtube.com/ramengvrl'
    },
    isVerified: true,
    followersCount: 65200
  },
  {
    name: 'Rich Brian',
    description: 'Indonesian rapper, singer, songwriter, and record producer. Known internationally for his viral hit "Dat $tick" and albums like "Amen" and "The Sailor."',
    imageUrl: 'https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?w=400&h=400&fit=crop&crop=face',
    genres: ['Hip Hop', 'Alternative Hip Hop', 'Electronic'],
    country: 'Indonesia',
    city: 'Jakarta',
    socialLinks: {
      spotify: 'https://open.spotify.com/artist/richbrian',
      instagram: 'https://instagram.com/richbrian',
      twitter: 'https://twitter.com/richbrian'
    },
    isVerified: true,
    followersCount: 890000
  },
  {
    name: 'NIKI',
    description: 'Indonesian singer, songwriter, and record producer. Known for her R&B and electronic-influenced pop music. Part of the 88rising collective and based between Jakarta and Los Angeles.',
    imageUrl: 'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=400&h=400&fit=crop&crop=face',
    genres: ['R&B', 'Electronic', 'Pop'],
    country: 'Indonesia',
    city: 'Jakarta',
    socialLinks: {
      spotify: 'https://open.spotify.com/artist/niki',
      instagram: 'https://instagram.com/nikizefanya',
      twitter: 'https://twitter.com/nikizefanya'
    },
    isVerified: true,
    followersCount: 750000
  },
  
  // Regional Indonesian Artists
  {
    name: 'Mocca',
    description: 'Indonesian indie pop band from Bandung known for their jazz-influenced electronic pop music. The band consists of Arina Ephipania, Riko Prayitno, Toma Pratama, and Achmad Pratama.',
    imageUrl: 'https://images.unsplash.com/photo-1556075798-4825dfaaf498?w=400&h=400&fit=crop&crop=face',
    genres: ['Indie Pop', 'Jazz', 'Electronic'],
    country: 'Indonesia',
    city: 'Bandung',
    socialLinks: {
      spotify: 'https://open.spotify.com/artist/mocca',
      instagram: 'https://instagram.com/moccamusic'
    },
    isVerified: true,
    followersCount: 145000
  },
  {
    name: 'Hindia',
    description: 'Indonesian indie musician known for electronic-influenced indie pop and alternative music. Based in Jakarta, creates introspective music with electronic elements.',
    imageUrl: 'https://images.unsplash.com/photo-1572442388796-11668a67e53d?w=400&h=400&fit=crop&crop=face',
    genres: ['Indie Pop', 'Electronic', 'Alternative'],
    country: 'Indonesia',
    city: 'Jakarta',
    socialLinks: {
      spotify: 'https://open.spotify.com/artist/hindia',
      instagram: 'https://instagram.com/baskara.hindia'
    },
    isVerified: true,
    followersCount: 42500
  }
];

// Sample artist shows/events data
const ARTIST_SHOWS = [
  {
    artistName: 'Dipha Barus',
    shows: [
      {
        venue: 'Istora Senayan',
        city: 'Jakarta',
        date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // +7 days
        time: '20:00',
        ticketPrice: 350000
      },
      {
        venue: 'Balai Sarbini',
        city: 'Jakarta', 
        date: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), // +14 days
        time: '21:00',
        ticketPrice: 275000
      }
    ]
  },
  {
    artistName: 'Weird Genius',
    shows: [
      {
        venue: 'ICE BSD City',
        city: 'Tangerang',
        date: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000), // +10 days
        time: '19:00',
        ticketPrice: 425000
      }
    ]
  },
  {
    artistName: 'Calvin Harris',
    shows: [
      {
        venue: 'Gelora Bung Karno Stadium',
        city: 'Jakarta',
        date: new Date(Date.now() + 21 * 24 * 60 * 60 * 1000), // +21 days
        time: '20:00',
        ticketPrice: 1250000
      }
    ]
  },
  {
    artistName: 'Martin Garrix',
    shows: [
      {
        venue: 'Jakarta International Expo',
        city: 'Jakarta',
        date: new Date(Date.now() + 28 * 24 * 60 * 60 * 1000), // +28 days
        time: '21:00',
        ticketPrice: 950000
      }
    ]
  }
];

async function seedArtists() {
  console.log('🎵 Starting artist seeding...');

  try {
    // Clear existing artist data
    console.log('🧹 Cleaning existing artist data...');
    await prisma.artistShow.deleteMany();
    await prisma.eventArtist.deleteMany();
    await prisma.userArtistFavorite.deleteMany();
    await prisma.artist.deleteMany();

    console.log('🎨 Creating artists...');
    
    for (const artistData of ARTIST_DATA) {
      const artist = await prisma.artist.create({
        data: {
          name: artistData.name,
          description: artistData.description,
          imageUrl: artistData.imageUrl,
          genres: artistData.genres,
          country: artistData.country,
          city: artistData.city,
          socialLinks: artistData.socialLinks,
          isVerified: artistData.isVerified,
          followersCount: artistData.followersCount,
          isActive: true
        }
      });

      console.log(`✅ Created artist: ${artist.name} (${artist.city})`);
    }

    console.log('🎪 Creating artist shows...');
    
    for (const artistShowData of ARTIST_SHOWS) {
      // Find the artist
      const artist = await prisma.artist.findFirst({
        where: { name: artistShowData.artistName }
      });

      if (!artist) {
        console.log(`⚠️ Artist not found: ${artistShowData.artistName}`);
        continue;
      }

      // Create shows for this artist
      for (const show of artistShowData.shows) {
        const artistShow = await prisma.artistShow.create({
          data: {
            artistId: artist.id,
            venue: show.venue,
            city: show.city,
            date: show.date,
            time: show.time,
            ticketPrice: show.ticketPrice.toString()
          }
        });

        console.log(`🎤 Created show: ${artistShow.venue} for ${artist.name}`);
      }
    }

    // Update follower counts based on number of shows
    console.log('📊 Updating artist statistics...');
    
    const artists = await prisma.artist.findMany({
      include: {
        shows: true,
        events: true
      }
    });

    for (const artist of artists) {
      const showCount = artist.shows.length;
      const eventCount = artist.events.length;
      
      // Slightly randomize follower count based on activity
      const activityBonus = (showCount + eventCount) * 1000;
      const randomVariation = Math.floor(Math.random() * 5000);
      
      await prisma.artist.update({
        where: { id: artist.id },
        data: {
          followersCount: artist.followersCount + activityBonus + randomVariation
        }
      });
    }

    const totalArtists = await prisma.artist.count();
    const totalShows = await prisma.artistShow.count();
    
    console.log('🎉 Artist seeding completed!');
    console.log(`📈 Summary:`);
    console.log(`   - ${totalArtists} artists created`);
    console.log(`   - ${totalShows} shows created`);
    console.log(`   - Mix of Indonesian and international electronic artists`);
    console.log(`   - Complete with descriptions, social links, and show data`);

  } catch (error) {
    console.error('❌ Error seeding artists:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the seed function
if (require.main === module) {
  seedArtists()
    .then(() => {
      console.log('✅ Artist seeding script completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Artist seeding failed:', error);
      process.exit(1);
    });
}

module.exports = { seedArtists, ARTIST_DATA, ARTIST_SHOWS };