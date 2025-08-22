#!/usr/bin/env node
/*
  Set today's Daily Drop from an Apple Music link.

  Usage:
    node scripts/set_daily_drop_from_apple.js "https://music.apple.com/id/album/adelaide-sky/1800199785?i=1800199786&l=id"

  Notes:
  - Stores the Apple Music trackViewUrl into the generic `spotifyUrl` field (used as external URL by the app).
  - If a DailyDrop for today exists, it will be updated; otherwise created.
*/

const axios = require('axios');
const { prisma } = require('../src/lib/prisma');

async function main() {
  const appleUrl = process.argv[2];
  if (!appleUrl) {
    console.error('Usage: node scripts/set_daily_drop_from_apple.js "<apple-music-link>"');
    process.exit(1);
  }

  let trackId;
  let country = 'US';

  try {
    const url = new URL(appleUrl);
    // Country from path like /id/album/... → "id"
    const segments = url.pathname.split('/').filter(Boolean);
    if (segments.length > 0 && segments[0].length === 2) {
      country = segments[0].toUpperCase();
    }
    // Track id from query param i=...
    trackId = url.searchParams.get('i');
  } catch (err) {
    console.error('Invalid URL provided:', err.message);
    process.exit(1);
  }

  if (!trackId) {
    console.error('Could not extract track id (query param "i") from the Apple Music URL.');
    process.exit(1);
  }

  console.log(`🎵 Fetching Apple track ${trackId} (country=${country})...`);

  const lookupUrl = 'https://itunes.apple.com/lookup';
  let item;
  try {
    const { data } = await axios.get(lookupUrl, {
      params: { id: trackId, country, entity: 'song' }
    });
    const results = Array.isArray(data?.results) ? data.results : [];
    if (results.length === 0) {
      throw new Error('No results from iTunes Lookup API');
    }
    item = results.find(r => r.kind === 'song') || results[0];
  } catch (err) {
    console.error('❌ Failed to fetch track data from iTunes Lookup API:', err.message);
    process.exit(1);
  }

  const artistName = String(item.artistName || '').trim();
  const trackName = String(item.trackName || '').trim();
  const albumImageUrl = String(item.artworkUrl100 || item.artworkUrl60 || '').trim();
  const previewUrl = String(item.previewUrl || '').trim();
  const trackViewUrl = String(item.trackViewUrl || appleUrl || '').trim();
  const durationMs = Number.isFinite(item.trackTimeMillis) ? item.trackTimeMillis : 30000;

  if (!artistName || !trackName) {
    console.error('❌ Missing artist or track name from Apple data.');
    process.exit(1);
  }

  // Normalize cover to larger size when available (replace 100x100 with 512x512)
  const coverUrl = albumImageUrl.replace(/\/(\d{2,4})x\1bb\./, '/512x512bb.');

  // Date = today at midnight
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  console.log(`🗄️ Upserting DailyDrop for ${today.toISOString().slice(0, 10)}...`);

  // Find existing drop for today
  const existing = await prisma.dailyDrop.findFirst({
    where: { date: { gte: today, lt: tomorrow } }
  });

  let saved;
  if (existing) {
    saved = await prisma.dailyDrop.update({
      where: { id: existing.id },
      data: {
        artistName,
        artistImageUrl: coverUrl || existing.artistImageUrl,
        trackName,
        albumImageUrl: coverUrl || existing.albumImageUrl,
        previewUrl: previewUrl || existing.previewUrl,
        spotifyUrl: trackViewUrl, // generic external URL (Apple Music)
        spotifyTrackId: null,
        durationMs,
        isActive: true,
      }
    });
  } else {
    saved = await prisma.dailyDrop.create({
      data: {
        artistName,
        artistImageUrl: coverUrl,
        trackName,
        albumImageUrl: coverUrl,
        previewUrl,
        spotifyUrl: trackViewUrl, // generic external URL (Apple Music)
        spotifyTrackId: null,
        durationMs,
        date: today,
        isActive: true,
      }
    });
  }

  console.log('✅ DailyDrop set to:', {
    id: saved.id,
    artistName: saved.artistName,
    trackName: saved.trackName,
    date: saved.date,
    previewUrl: Boolean(saved.previewUrl),
    externalUrl: saved.spotifyUrl,
  });
}

main()
  .catch((err) => {
    console.error('❌ Unexpected error:', err);
    process.exit(1);
  })
  .finally(async () => {
    try { await prisma.$disconnect(); } catch (_) {}
  });

