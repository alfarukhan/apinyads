#!/usr/bin/env node
/*
  Seed featured tracks for events with Apple Music examples.
  
  Usage:
    node scripts/seed_featured_tracks.js
*/

const axios = require('axios');
const { prisma } = require('../src/lib/prisma');

// Sample Apple Music tracks for demo
const SAMPLE_TRACKS = [
  // Electronic/Dance tracks
  {
    appleTrackId: '1800199786',
    country: 'ID'
  },
  {
    appleTrackId: '1440857781', // Blinding Lights - The Weeknd
    country: 'US'
  },
  {
    appleTrackId: '1531234002', // Levitating - Dua Lipa
    country: 'US'
  },
  {
    appleTrackId: '1619406544', // Good 4 U - Olivia Rodrigo
    country: 'US'
  },
  {
    appleTrackId: '1529589748', // Peaches - Justin Bieber
    country: 'US'
  },
  {
    appleTrackId: '1576250625', // positions - Ariana Grande
    country: 'US'
  },
];

async function fetchAppleTrack(trackId, country = 'US') {
  try {
    const { data } = await axios.get('https://itunes.apple.com/lookup', {
      params: { id: trackId, country, entity: 'song' },
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 10000
    });

    const results = Array.isArray(data?.results) ? data.results : [];
    const track = results.find(r => r.kind === 'song') || results[0];
    
    if (!track) return null;

    return {
      title: String(track.trackName || '').trim(),
      artistName: String(track.artistName || '').trim(),
      coverUrl: String(track.artworkUrl100 || track.artworkUrl60 || '').replace(/\/(\d{2,4})x\1bb\./, '/512x512bb.'),
      previewUrl: String(track.previewUrl || '').trim(),
      externalUrl: String(track.trackViewUrl || '').trim(),
      appleTrackId: String(track.trackId || trackId).trim(),
      durationMs: Number.isFinite(track.trackTimeMillis) ? track.trackTimeMillis : 30000,
      provider: 'APPLE_MUSIC'
    };
  } catch (error) {
    console.error(`❌ Failed to fetch Apple track ${trackId}:`, error.message);
    return null;
  }
}

async function main() {
  console.log('🎵 Seeding featured tracks from Apple Music...');

  // Get first 5 active events
  const events = await prisma.event.findMany({
    where: { isActive: true },
    select: { id: true, title: true },
    take: 5,
    orderBy: { createdAt: 'desc' }
  });

  if (events.length === 0) {
    console.log('❌ No events found. Please create some events first.');
    return;
  }

  console.log(`📅 Found ${events.length} events to seed`);

  // Fetch track data in parallel
  console.log('🔍 Fetching Apple Music track data...');
  const trackPromises = SAMPLE_TRACKS.map(t => fetchAppleTrack(t.appleTrackId, t.country));
  const trackData = (await Promise.all(trackPromises)).filter(Boolean);

  if (trackData.length === 0) {
    console.log('❌ Failed to fetch any Apple Music tracks.');
    return;
  }

  console.log(`✅ Fetched ${trackData.length} Apple Music tracks`);

  // Seed featured tracks for each event
  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    console.log(`\n🎯 Seeding tracks for event: "${event.title}"`);

    // Clear existing featured tracks
    await prisma.eventFeaturedTrack.updateMany({
      where: { eventId: event.id },
      data: { isActive: false }
    });

    // Pick 3 tracks for this event (cycling through available tracks)
    const eventTracks = [];
    for (let pos = 1; pos <= 3; pos++) {
      const trackIndex = (i * 3 + pos - 1) % trackData.length;
      const track = trackData[trackIndex];
      
      if (track) {
        eventTracks.push({
          eventId: event.id,
          position: pos,
          ...track
        });
      }
    }

    // Insert tracks
    for (const track of eventTracks) {
      try {
        const created = await prisma.eventFeaturedTrack.create({
          data: track,
          select: { id: true, title: true, artistName: true, position: true }
        });
        console.log(`  ✅ Position ${created.position}: "${created.title}" by ${created.artistName}`);
      } catch (error) {
        console.error(`  ❌ Failed to create track at position ${track.position}:`, error.message);
      }
    }
  }

  console.log('\n🎉 Featured tracks seeding completed!');

  // Show summary
  const totalTracks = await prisma.eventFeaturedTrack.count({
    where: { isActive: true }
  });
  console.log(`📊 Total active featured tracks: ${totalTracks}`);
}

main()
  .catch((error) => {
    console.error('❌ Seeding failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    try { await prisma.$disconnect(); } catch (_) {}
  });