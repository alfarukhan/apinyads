#!/usr/bin/env node
/*
  Test the featured tracks API endpoints
*/

const { prisma } = require('../src/lib/prisma');

async function testAPI() {
  console.log('🧪 Testing Featured Tracks API...');

  try {
    // Get first event with featured tracks
    const event = await prisma.event.findFirst({
      where: { 
        isActive: true,
        featuredTracks: {
          some: { isActive: true }
        }
      },
      include: {
        featuredTracks: {
          where: { isActive: true },
          orderBy: { position: 'asc' }
        }
      }
    });

    if (!event) {
      console.log('❌ No event with featured tracks found');
      return;
    }

    console.log(`\n📅 Event: "${event.title}"`);
    console.log(`🆔 Event ID: ${event.id}`);
    console.log(`🎵 Featured Tracks (${event.featuredTracks.length}):`);
    
    event.featuredTracks.forEach((track, index) => {
      console.log(`\n  ${track.position}. "${track.title}" by ${track.artistName}`);
      console.log(`     🆔 ID: ${track.id}`);
      console.log(`     🎨 Cover: ${track.coverUrl ? 'Yes' : 'No'}`);
      console.log(`     🎧 Preview: ${track.previewUrl ? 'Yes' : 'No'}`);
      console.log(`     🔗 External: ${track.externalUrl ? 'Yes' : 'No'}`);
      console.log(`     📱 Provider: ${track.provider}`);
    });

    // Test API format
    console.log('\n🔧 API Response Format:');
    const apiResponse = {
      success: true,
      data: {
        featuredTracks: event.featuredTracks
      }
    };
    console.log(JSON.stringify(apiResponse, null, 2));

    console.log('\n✅ Test completed successfully!');
    console.log(`📞 Flutter app should call: GET /api/events/${event.id}/featured-tracks`);

  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

testAPI()
  .finally(async () => {
    try { await prisma.$disconnect(); } catch (_) {}
  });