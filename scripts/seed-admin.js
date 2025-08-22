const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function seedAdmin() {
  try {
    console.log('👑 Creating admin user...');

    // Check if admin already exists
    const existingAdmin = await prisma.user.findUnique({
      where: { email: 'admin@dancesignal.com' }
    });

    if (existingAdmin) {
      console.log('⚠️  Admin user already exists!');
      console.log(`📧 Email: admin@dancesignal.com`);
      console.log(`👤 Username: ${existingAdmin.username || 'admin'}`);
      console.log(`🔑 Password: pass1234`);
      console.log(`🆔 ID: ${existingAdmin.id}`);
      return;
    }

    // Hash password
    const hashedPassword = await bcrypt.hash('pass1234', 12);

    // Create admin user
    const admin = await prisma.user.create({
      data: {
        email: 'admin@dancesignal.com',
        username: 'admin',
        password: hashedPassword,
        firstName: 'Admin',
        lastName: 'DanceSignal',
        role: 'ADMIN',
        isActive: true,
        isEmailVerified: true,
        isPhoneVerified: true,
        isVerified: true, // Blue checkmark for admin
        phone: '+6281234567890',
        dateOfBirth: new Date('1990-01-01'),
        gender: 'MALE',
        city: 'Jakarta',
        country: 'Indonesia',
        bio: 'DanceSignal Administrator',
        avatar: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=400',
        favoriteGenres: ['EDM', 'House', 'Techno'],
        points: 1000,
        status: 'ACTIVE'
      }
    });

    console.log('');
    console.log('🎉 Admin user created successfully!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📧 Email: admin@dancesignal.com');
    console.log('👤 Username: admin');
    console.log('🔑 Password: pass1234');
    console.log(`🆔 ID: ${admin.id}`);
    console.log('👑 Role: ADMIN');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('');
    console.log('💡 You can now login to the CMS with these credentials');

  } catch (error) {
    console.error('❌ Failed to create admin user:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the seed
seedAdmin();
