/**
 * Script to fix community creator memberships
 * Ensures all community creators have proper CommunityMember records
 */

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function fixCommunityMemberships() {
  console.log('🔧 Starting community membership fix...');

  try {
    // Get all communities and check their creator memberships
    const communities = await prisma.community.findMany({
      select: {
        id: true,
        name: true,
        adminId: true,
        createdAt: true
      }
    });

    console.log(`📊 Found ${communities.length} communities to check`);

    let fixedCount = 0;
    let alreadyFixedCount = 0;

    for (const community of communities) {
      // Check if creator has CommunityMember record
      const existingMembership = await prisma.communityMember.findUnique({
        where: {
          communityId_userId: {
            communityId: community.id,
            userId: community.adminId
          }
        }
      });

      if (!existingMembership) {
        // Create missing CommunityMember record for creator
        await prisma.communityMember.create({
          data: {
            communityId: community.id,
            userId: community.adminId,
            role: 'ADMIN',
            joinedAt: community.createdAt
          }
        });

        console.log(`✅ Fixed: ${community.name} - Created ADMIN membership for creator`);
        fixedCount++;
      } else {
        console.log(`ℹ️ OK: ${community.name} - Creator already has membership (${existingMembership.role})`);
        alreadyFixedCount++;
      }
    }

    // Update member counts
    console.log('📊 Updating member counts...');
    
    for (const community of communities) {
      const realMemberCount = await prisma.communityMember.count({
        where: { communityId: community.id }
      });

      await prisma.community.update({
        where: { id: community.id },
        data: { memberCount: realMemberCount }
      });
    }

    console.log('🎉 Community membership fix completed!');
    console.log(`📈 Fixed: ${fixedCount} communities`);
    console.log(`✅ Already OK: ${alreadyFixedCount} communities`);
    console.log(`📊 Total: ${communities.length} communities checked`);

  } catch (error) {
    console.error('❌ Error fixing community memberships:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the fix
if (require.main === module) {
  fixCommunityMemberships()
    .then(() => {
      console.log('✅ Script completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Script failed:', error);
      process.exit(1);
    });
}

module.exports = { fixCommunityMemberships };
