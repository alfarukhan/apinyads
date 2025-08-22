/**
 * Migration script to generate slugs for existing news articles
 * Run with: node src/migrations/generate-news-slugs.js
 */

const { PrismaClient } = require('@prisma/client');
const { generateNewsSlug } = require('../utils/slug-generator');

const prisma = new PrismaClient();

async function generateSlugsForExistingArticles() {
  console.log('🔄 Starting slug generation migration...');
  
  try {
    // Get all articles that don't have slugs
    const articlesWithoutSlugs = await prisma.news.findMany({
      where: {
        OR: [
          { slug: null },
          { slug: '' }
        ]
      },
      select: {
        id: true,
        title: true,
        createdAt: true
      },
      orderBy: {
        createdAt: 'asc'
      }
    });

    if (articlesWithoutSlugs.length === 0) {
      console.log('✅ All articles already have slugs. Migration not needed.');
      return;
    }

    console.log(`📊 Found ${articlesWithoutSlugs.length} articles without slugs`);

    // Function to check if slug exists
    const checkSlugExists = async (slug) => {
      const existing = await prisma.news.findUnique({
        where: { slug },
        select: { id: true }
      });
      return !!existing;
    };

    let processed = 0;
    let errors = 0;

    // Process each article
    for (const article of articlesWithoutSlugs) {
      try {
        console.log(`\n🔄 Processing: "${article.title}"`);
        
        // Generate unique slug
        const slug = await generateNewsSlug(article.title, checkSlugExists);
        
        // Update article with generated slug
        await prisma.news.update({
          where: { id: article.id },
          data: { slug }
        });

        console.log(`✅ Generated slug: "${slug}"`);
        processed++;
        
      } catch (error) {
        console.error(`❌ Error processing article "${article.title}":`, error.message);
        errors++;
      }
    }

    // Final summary
    console.log('\n📊 Migration Summary:');
    console.log(`✅ Successfully processed: ${processed} articles`);
    console.log(`❌ Errors: ${errors} articles`);
    
    if (errors === 0) {
      console.log('🎉 Migration completed successfully!');
    } else {
      console.log('⚠️ Migration completed with some errors. Please review the failed articles.');
    }

    // Verify migration
    const remainingWithoutSlugs = await prisma.news.count({
      where: {
        OR: [
          { slug: null },
          { slug: '' }
        ]
      }
    });

    if (remainingWithoutSlugs === 0) {
      console.log('✅ Verification: All articles now have slugs');
    } else {
      console.log(`⚠️ Verification: ${remainingWithoutSlugs} articles still missing slugs`);
    }

  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run migration if this file is executed directly
if (require.main === module) {
  generateSlugsForExistingArticles()
    .then(() => {
      console.log('🏁 Migration script finished');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Migration script failed:', error);
      process.exit(1);
    });
}

module.exports = { generateSlugsForExistingArticles };