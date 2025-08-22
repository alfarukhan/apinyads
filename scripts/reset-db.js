const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function resetDatabase() {
  try {
    console.log('🔄 Starting database reset...');

    // Get all table names (PostgreSQL version)
    const tables = await prisma.$queryRaw`
      SELECT tablename as name FROM pg_tables 
      WHERE schemaname = 'public' 
      AND tablename NOT LIKE '_prisma%'
    `;

    console.log(`📋 Found ${tables.length} tables to reset`);

    // Disable foreign key constraints (PostgreSQL)
    await prisma.$executeRaw`SET session_replication_role = replica`;

    // Delete all records from each table
    for (const table of tables) {
      const tableName = table.name;
      console.log(`🗑️  Clearing table: ${tableName}`);
      
      try {
        await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${tableName}" CASCADE`);
        console.log(`   ✅ Cleared ${tableName}`);
      } catch (error) {
        console.log(`   ⚠️  Error clearing ${tableName}: ${error.message}`);
      }
    }

    // Re-enable foreign key constraints (PostgreSQL)
    await prisma.$executeRaw`SET session_replication_role = DEFAULT`;

    console.log('');
    console.log('🎉 Database reset completed successfully!');
    console.log('📝 All tables have been cleared');
    console.log('💡 Run "npm run seed:admin" to create admin user');

  } catch (error) {
    console.error('❌ Database reset failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the reset
resetDatabase();
