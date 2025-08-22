/**
 * 📝 CENTRALIZED VALIDATION SCHEMAS
 * 
 * Enterprise-grade validation schemas using Joi to eliminate
 * duplicate schema definitions across routes.
 */

const Joi = require('joi');

// =============================
// USER VALIDATION SCHEMAS
// =============================

const userRegisterSchema = Joi.object({
  email: Joi.string().email().required(),
  username: Joi.string().alphanum().min(3).max(30).required(),
  password: Joi.string().min(6).required(),
  firstName: Joi.string().min(1).max(50).optional(),
  lastName: Joi.string().min(1).max(50).optional(),
  phone: Joi.string().optional(),
  city: Joi.string().optional(),
  gender: Joi.string().valid('MALE', 'FEMALE', 'OTHER', 'PREFER_NOT_TO_SAY').optional(),
});

const userLoginSchema = Joi.object({
  identifier: Joi.string().optional(),
  email: Joi.string().optional(), // Legacy support
  password: Joi.string().required(),
}).or('identifier', 'email'); // At least one of identifier or email must be present

const userUpdateProfileSchema = Joi.object({
  firstName: Joi.string().min(1).max(50).optional(),
  lastName: Joi.string().min(1).max(50).optional(),
  phone: Joi.string().optional(),
  bio: Joi.string().max(500).optional(),
  city: Joi.string().optional(),
  country: Joi.string().optional(),
  dateOfBirth: Joi.date().optional(),
  gender: Joi.string().valid('MALE', 'FEMALE', 'OTHER', 'PREFER_NOT_TO_SAY').optional(),
  favoriteGenres: Joi.array().items(Joi.string()).optional(),
  avatarUrl: Joi.string().uri().optional(),
});

// =============================
// EVENT VALIDATION SCHEMAS
// =============================

// Ticket tier sub-schema
const ticketTierSchema = Joi.object({
  id: Joi.string().required(),
  name: Joi.string().min(1).max(100).required(),
  price: Joi.string().required(), // String because it comes from frontend as string
  quantity: Joi.string().required(), // String because it comes from frontend as string
  description: Joi.string().allow('').optional(),
});

// Lineup artist sub-schema
const lineupArtistSchema = Joi.object({
  id: Joi.string().required(),
  name: Joi.string().min(1).max(100).required(),
  stageName: Joi.string().min(1).max(100).optional(), // Stage name for display
  imageUrl: Joi.string().uri().allow(null).optional(), // Profile image
  isManual: Joi.boolean().optional().default(false),
  artistId: Joi.string().optional(), // For existing artists (null for manual)
});

// Featured track sub-schema
const featuredTrackSchema = Joi.object({
  id: Joi.string().required(),
  title: Joi.string().min(1).max(200).required(),
  artistName: Joi.string().min(1).max(100).required(),
  coverUrl: Joi.string().uri().optional(),
  previewUrl: Joi.string().uri().optional(),
  externalUrl: Joi.string().uri().optional(),
  appleTrackId: Joi.string().optional(),
  durationMs: Joi.number().integer().min(0).optional(),
  position: Joi.number().integer().min(1).max(3).optional(), // Position in lineup (1-3)
  provider: Joi.string().valid('APPLE_MUSIC', 'SPOTIFY', 'YOUTUBE', 'SOUNDCLOUD').default('APPLE_MUSIC').optional(),
});

const eventCreateSchema = Joi.object({
  title: Joi.string().min(1).max(200).required(),
  description: Joi.string().optional(),
  imageUrl: Joi.string().uri().optional(),
  location: Joi.string().required(),
  address: Joi.string().optional(),
  latitude: Joi.number().optional(),
  longitude: Joi.number().optional(),
  startDate: Joi.date().required(),
  endDate: Joi.date().optional(),
  startTime: Joi.string().optional(),
  endTime: Joi.string().optional(),
  // Ticket tiers (new system)
  ticketTiers: Joi.array().items(ticketTierSchema).min(1).required(),
  currency: Joi.string().valid('IDR', 'USD', 'EUR', 'GBP', 'SGD', 'AUD').default('IDR'),
  // Legacy price field (deprecated but kept for backward compatibility)
  price: Joi.number().integer().min(0).optional(),
  capacity: Joi.number().integer().min(1).optional(),
  genres: Joi.array().items(Joi.string()).optional(),
  category: Joi.string().optional(),
  hasGuestlist: Joi.boolean().optional(),
  isPublic: Joi.boolean().optional(),
  status: Joi.string().valid('DRAFT', 'PUBLISHED', 'CANCELLED', 'COMPLETED', 'POSTPONED').optional(),
  venueId: Joi.string().optional(),
  // Tax configuration
  taxRate: Joi.number().min(0).max(1).optional(),
  taxType: Joi.string().valid('PERCENTAGE', 'FIXED').optional(),
  taxName: Joi.string().optional(),
  // Guestlist configuration
  guestlistCapacity: Joi.number().integer().min(1).optional(),
  guestlistAutoApprove: Joi.boolean().optional(),
  // Legacy field (deprecated but kept for backward compatibility)
  guestlistRequiresApproval: Joi.boolean().optional(),
  // Lineup and featured tracks
  lineup: Joi.array().items(lineupArtistSchema).optional(),
  featuredTracks: Joi.array().items(featuredTrackSchema).max(3).optional(),
});

const eventUpdateSchema = eventCreateSchema.fork(['title', 'location', 'startDate', 'ticketTiers'], (schema) => schema.optional());

// =============================
// ACCESS TIER VALIDATION SCHEMAS
// =============================

const accessTierCreateSchema = Joi.object({
  name: Joi.string().min(1).max(100).required(),
  description: Joi.string().optional(),
  price: Joi.number().integer().min(0).required(),
  maxQuantity: Joi.number().integer().min(1).required(),
  benefits: Joi.array().items(Joi.string()).optional(),
  saleStartDate: Joi.date().optional(),
  saleEndDate: Joi.date().optional(),
  sortOrder: Joi.number().integer().min(0).optional(),
});

const accessTierUpdateSchema = accessTierCreateSchema.fork(['name', 'price', 'maxQuantity'], (schema) => schema.optional());

// =============================
// BOOKING VALIDATION SCHEMAS
// =============================

const bookingCreateSchema = Joi.object({
  accessTierId: Joi.string().required(),
  paymentMethod: Joi.string().valid(
    'GOPAY', 'QRIS', 'SHOPEEPAY', 'DANA',
    'BCA_VA', 'MANDIRI_VA', 'BNI_VA', 'BRIVA', 'PERMATA_VA', 'CIMB_VA', 'OTHER_VA',
    'CREDIT_CARD', 'INDOMARET', 'ALFAMART', 'AKULAKU', 'KREDIVO'
  ).required(),
  quantity: Joi.number().integer().min(1).max(10).required(),
});

// =============================
// ACCESS TRANSFER VALIDATION SCHEMAS
// =============================

const accessTransferSchema = Joi.object({
  recipientIdentifier: Joi.string().required(), // email, username, or phone
  reason: Joi.string().max(200).optional(),
});

// =============================
// PAGINATION & SEARCH SCHEMAS
// =============================

const paginationSchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(10),
  search: Joi.string().allow('').default(''),
  sortBy: Joi.string().optional(),
  sortOrder: Joi.string().valid('asc', 'desc').default('desc'),
});

const userSearchSchema = paginationSchema.keys({
  role: Joi.string().valid('USER', 'ADMIN', 'ORGANIZER', 'ARTIST', 'LABEL', 'MODERATOR').optional(),
  isActive: Joi.boolean().optional(),
  isVerified: Joi.boolean().optional(),
});

const eventSearchSchema = paginationSchema.keys({
  status: Joi.string().valid('DRAFT', 'PUBLISHED', 'CANCELLED', 'COMPLETED', 'POSTPONED').optional(),
  category: Joi.string().optional(),
  genres: Joi.array().items(Joi.string()).optional(),
  city: Joi.string().optional(),
  startDate: Joi.date().optional(),
  endDate: Joi.date().optional(),
  organizerId: Joi.string().optional(),
});

// =============================
// ARTIST VALIDATION SCHEMAS
// =============================

const artistCreateSchema = Joi.object({
  name: Joi.string().min(1).max(100).required(),
  description: Joi.string().optional(),
  imageUrl: Joi.string().uri().optional(),
  genres: Joi.array().items(Joi.string()).optional(),
  country: Joi.string().optional(),
  city: Joi.string().optional(),
  socialLinks: Joi.object().optional(),
});

const artistUpdateSchema = artistCreateSchema.fork(['name'], (schema) => schema.optional());

// =============================
// VENUE VALIDATION SCHEMAS
// =============================

const venueCreateSchema = Joi.object({
  name: Joi.string().min(1).max(100).required(),
  description: Joi.string().optional(),
  imageUrl: Joi.string().uri().optional(),
  location: Joi.string().required(),
  address: Joi.string().optional(),
  latitude: Joi.number().optional(),
  longitude: Joi.number().optional(),
  phone: Joi.string().optional(),
  website: Joi.string().uri().optional(),
  email: Joi.string().email().optional(),
  operatingHours: Joi.object().optional(),
  amenities: Joi.array().items(Joi.string()).optional(),
  capacity: Joi.number().integer().min(1).optional(),
});

const venueUpdateSchema = venueCreateSchema.fork(['name', 'location'], (schema) => schema.optional());

// =============================
// NOTIFICATION VALIDATION SCHEMAS
// =============================

const notificationCreateSchema = Joi.object({
  userId: Joi.string().required(),
  type: Joi.string().required(),
  title: Joi.string().min(1).max(200).required(),
  body: Joi.string().min(1).max(500).required(),
  imageUrl: Joi.string().uri().optional(),
  actionData: Joi.object().optional(),
});

module.exports = {
  // User schemas
  userRegisterSchema,
  userLoginSchema,
  userUpdateProfileSchema,
  
  // Event schemas
  eventCreateSchema,
  eventUpdateSchema,
  
  // Access tier schemas
  accessTierCreateSchema,
  accessTierUpdateSchema,
  
  // Booking schemas
  bookingCreateSchema,
  
  // Transfer schemas
  accessTransferSchema,
  
  // Search & pagination schemas
  paginationSchema,
  userSearchSchema,
  eventSearchSchema,
  
  // Artist schemas
  artistCreateSchema,
  artistUpdateSchema,
  
  // Venue schemas
  venueCreateSchema,
  venueUpdateSchema,
  
  // Notification schemas
  notificationCreateSchema,
};