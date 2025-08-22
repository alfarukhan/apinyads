// ✅ ENTERPRISE: Use centralized singleton instead of new instance
const { prisma } = require('../../lib/prisma');
const ConfigService = require('./ConfigService');
const AuditLogService = require('./AuditLogService'); // ✅ FIX: Direct import to avoid circular dependency
const CacheService = require('./CacheService');

/**
 * 🏢 CENTRALIZED BUSINESS VALIDATION SERVICE
 * 
 * Comprehensive business logic validation for DanceSignal:
 * - Event capacity & availability validation
 * - User eligibility & profile completion checks
 * - Booking rules & constraints validation
 * - Payment eligibility & limit checks
 * - Guestlist approval & criteria validation
 * - Cross-entity dependency validation
 * 
 * ✅ Consistency: Unified business rules across the platform
 * ✅ Performance: Cached validation results
 * ✅ Flexibility: Configurable validation rules
 * ✅ Reliability: Comprehensive error handling
 */
class BusinessValidationService {
  constructor() {
    // ✅ ENTERPRISE: Use centralized singleton
const { prisma } = require('../../../lib/prisma');
    this.prisma = prisma; // new PrismaClient();
    this.configService = new ConfigService();
    // ✅ FIX: Direct instantiation to avoid circular dependency with service factory
    this.auditService = new AuditLogService();
    this.cacheService = new CacheService();

    // ✅ Business validation configuration
    this.config = {
      // Event validation
      MIN_EVENT_ADVANCE_BOOKING_HOURS: parseInt(process.env.MIN_EVENT_ADVANCE_BOOKING_HOURS) || 1,
      MAX_EVENT_ADVANCE_BOOKING_DAYS: parseInt(process.env.MAX_EVENT_ADVANCE_BOOKING_DAYS) || 365,
      MIN_EVENT_CAPACITY: parseInt(process.env.MIN_EVENT_CAPACITY) || 1,
      MAX_EVENT_CAPACITY: parseInt(process.env.MAX_EVENT_CAPACITY) || 100000,
      
      // Booking validation
      MAX_BOOKINGS_PER_USER_PER_EVENT: parseInt(process.env.MAX_BOOKINGS_PER_USER_PER_EVENT) || 1,
      MAX_TICKETS_PER_BOOKING: parseInt(process.env.MAX_TICKETS_PER_BOOKING) || 10,
      MIN_BOOKING_AMOUNT: parseInt(process.env.MIN_BOOKING_AMOUNT) || 1000, // IDR
      
      // User validation
      MIN_PROFILE_COMPLETION_PERCENTAGE: parseInt(process.env.MIN_PROFILE_COMPLETION_PERCENTAGE) || 50,
      REQUIRE_EMAIL_VERIFICATION: process.env.REQUIRE_EMAIL_VERIFICATION !== 'false',
      REQUIRE_PHONE_VERIFICATION: process.env.REQUIRE_PHONE_VERIFICATION === 'true',
      MIN_USER_AGE: parseInt(process.env.MIN_USER_AGE) || 13,
      
      // Guestlist validation
      ENABLE_GUESTLIST_APPROVAL: process.env.ENABLE_GUESTLIST_APPROVAL !== 'false',
      MAX_GUESTLIST_REQUESTS_PER_USER: parseInt(process.env.MAX_GUESTLIST_REQUESTS_PER_USER) || 5,
      GUESTLIST_DEADLINE_HOURS: parseInt(process.env.GUESTLIST_DEADLINE_HOURS) || 24,
      
      // Organizer validation
      MIN_ORGANIZER_EVENTS_FOR_VERIFICATION: parseInt(process.env.MIN_ORGANIZER_EVENTS_FOR_VERIFICATION) || 3,
      REQUIRE_ORGANIZER_VERIFICATION: process.env.REQUIRE_ORGANIZER_VERIFICATION === 'true',
      
      // Performance
      CACHE_VALIDATION_RESULTS: process.env.CACHE_VALIDATION_RESULTS !== 'false',
      VALIDATION_CACHE_TTL: parseInt(process.env.VALIDATION_CACHE_TTL) || 300 // 5 minutes
    };

    // ✅ Validation statistics
    this.stats = {
      totalValidations: 0,
      successfulValidations: 0,
      failedValidations: 0,
      cachedResults: 0,
      validationTypes: {
        event: 0,
        booking: 0,
        user: 0,
        guestlist: 0,
        payment: 0
      }
    };

    console.log('🏢 BusinessValidationService initialized:', {
      minProfileCompletion: `${this.config.MIN_PROFILE_COMPLETION_PERCENTAGE}%`,
      maxTicketsPerBooking: this.config.MAX_TICKETS_PER_BOOKING,
      requireEmailVerification: this.config.REQUIRE_EMAIL_VERIFICATION,
      cacheValidations: this.config.CACHE_VALIDATION_RESULTS
    });
  }

  /**
   * 🎪 EVENT VALIDATION
   */

  async validateEventCreation(eventData, organizerId, options = {}) {
    const { skipCache = false } = options;
    const cacheKey = `event_creation_validation:${organizerId}:${JSON.stringify(eventData).substring(0, 50)}`;

    try {
      // ✅ Check cache first
      if (!skipCache && this.config.CACHE_VALIDATION_RESULTS) {
        const cachedResult = await this.cacheService.get(cacheKey, 'business_validation');
        if (cachedResult) {
          this.stats.cachedResults++;
          return cachedResult;
        }
      }

      this.stats.totalValidations++;
      this.stats.validationTypes.event++;

      const validationResult = {
        valid: true,
        errors: [],
        warnings: [],
        requirements: []
      };

      // ✅ Basic event data validation
      await this.validateEventBasicData(eventData, validationResult);

      // ✅ Organizer eligibility validation
      await this.validateOrganizerEligibility(organizerId, validationResult);

      // ✅ Event timing validation
      await this.validateEventTiming(eventData, validationResult);

      // ✅ Event capacity validation
      await this.validateEventCapacity(eventData, validationResult);

      // ✅ Location validation
      await this.validateEventLocation(eventData, validationResult);

      // ✅ Update statistics
      if (validationResult.valid) {
        this.stats.successfulValidations++;
      } else {
        this.stats.failedValidations++;
      }

      // ✅ Cache result
      if (this.config.CACHE_VALIDATION_RESULTS) {
        await this.cacheService.set(cacheKey, validationResult, this.config.VALIDATION_CACHE_TTL, 'business_validation');
      }

      return validationResult;

    } catch (error) {
      console.error('❌ Event creation validation failed:', error);
      this.stats.failedValidations++;
      
      return {
        valid: false,
        errors: [{ field: 'event', message: error.message, code: 'VALIDATION_ERROR' }],
        warnings: [],
        requirements: []
      };
    }
  }

  async validateEventBookingEligibility(eventId, userId, quantity = 1, options = {}) {
    const { skipCache = false, accessTierId = null } = options;
    const cacheKey = `booking_eligibility:${eventId}:${userId}:${quantity}:${accessTierId}`;

    try {
      // ✅ Check cache first
      if (!skipCache && this.config.CACHE_VALIDATION_RESULTS) {
        const cachedResult = await this.cacheService.get(cacheKey, 'business_validation');
        if (cachedResult) {
          this.stats.cachedResults++;
          return cachedResult;
        }
      }

      this.stats.totalValidations++;
      this.stats.validationTypes.booking++;

      const validationResult = {
        valid: true,
        errors: [],
        warnings: [],
        requirements: []
      };

      // ✅ Get event and user data
      const [event, user] = await Promise.all([
        this.prisma.event.findUnique({
          where: { id: eventId },
          include: {
            accessTiers: true,
            organizer: { select: { id: true, isVerified: true } }
          }
        }),
        this.prisma.user.findUnique({
          where: { id: userId },
          select: { 
            id: true, 
            isVerified: true, 
            isActive: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
            avatar: true,
            createdAt: true
          }
        })
      ]);

      if (!event) {
        validationResult.valid = false;
        validationResult.errors.push({
          field: 'event',
          message: 'Event not found',
          code: 'EVENT_NOT_FOUND'
        });
        return validationResult;
      }

      if (!user) {
        validationResult.valid = false;
        validationResult.errors.push({
          field: 'user',
          message: 'User not found',
          code: 'USER_NOT_FOUND'
        });
        return validationResult;
      }

      // ✅ Event status validation
      await this.validateEventStatus(event, validationResult);

      // ✅ User eligibility validation
      await this.validateUserEligibility(user, validationResult);

      // ✅ Booking quantity validation
      await this.validateBookingQuantity(eventId, userId, quantity, validationResult);

      // ✅ Capacity validation
      await this.validateEventAvailability(event, quantity, accessTierId, validationResult);

      // ✅ Duplicate booking validation
      await this.validateNoDuplicateBooking(eventId, userId, validationResult);

      // ✅ Timing validation
      await this.validateBookingTiming(event, validationResult);

      // ✅ Update statistics
      if (validationResult.valid) {
        this.stats.successfulValidations++;
      } else {
        this.stats.failedValidations++;
      }

      // ✅ Cache result (shorter TTL for booking eligibility)
      if (this.config.CACHE_VALIDATION_RESULTS) {
        await this.cacheService.set(cacheKey, validationResult, 60, 'business_validation'); // 1 minute cache
      }

      return validationResult;

    } catch (error) {
      console.error('❌ Booking eligibility validation failed:', error);
      this.stats.failedValidations++;
      
      return {
        valid: false,
        errors: [{ field: 'booking', message: error.message, code: 'VALIDATION_ERROR' }],
        warnings: [],
        requirements: []
      };
    }
  }

  /**
   * 👤 USER VALIDATION
   */

  async validateUserProfileCompletion(userId, options = {}) {
    const { minimumPercentage = this.config.MIN_PROFILE_COMPLETION_PERCENTAGE } = options;

    try {
      this.stats.totalValidations++;
      this.stats.validationTypes.user++;

      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
          avatar: true,
          city: true,
          isVerified: true,
          emailVerifiedAt: true,
          phoneVerifiedAt: true
        }
      });

      if (!user) {
        return {
          valid: false,
          errors: [{ field: 'user', message: 'User not found', code: 'USER_NOT_FOUND' }],
          warnings: [],
          requirements: []
        };
      }

      // ✅ Calculate profile completion
      const completion = this.calculateProfileCompletion(user);
      
      const validationResult = {
        valid: completion.percentage >= minimumPercentage,
        errors: [],
        warnings: [],
        requirements: [],
        metadata: {
          completionPercentage: completion.percentage,
          completedFields: completion.completedFields,
          missingFields: completion.missingFields,
          minimumRequired: minimumPercentage
        }
      };

      if (!validationResult.valid) {
        validationResult.errors.push({
          field: 'profile',
          message: `Profile completion is ${completion.percentage}%, minimum required is ${minimumPercentage}%`,
          code: 'INSUFFICIENT_PROFILE_COMPLETION'
        });

        validationResult.requirements.push({
          type: 'PROFILE_COMPLETION',
          message: `Please complete your profile. Missing: ${completion.missingFields.join(', ')}`,
          fields: completion.missingFields
        });
      }

      // ✅ Email verification check
      if (this.config.REQUIRE_EMAIL_VERIFICATION && !user.isVerified) {
        validationResult.requirements.push({
          type: 'EMAIL_VERIFICATION',
          message: 'Email verification is required',
          field: 'email'
        });
      }

      // ✅ Phone verification check
      if (this.config.REQUIRE_PHONE_VERIFICATION && !user.phoneVerifiedAt) {
        validationResult.requirements.push({
          type: 'PHONE_VERIFICATION',
          message: 'Phone verification is required',
          field: 'phone'
        });
      }

      // ✅ Update statistics
      if (validationResult.valid) {
        this.stats.successfulValidations++;
      } else {
        this.stats.failedValidations++;
      }

      return validationResult;

    } catch (error) {
      console.error('❌ User profile validation failed:', error);
      this.stats.failedValidations++;
      
      return {
        valid: false,
        errors: [{ field: 'user', message: error.message, code: 'VALIDATION_ERROR' }],
        warnings: [],
        requirements: []
      };
    }
  }

  /**
   * 📝 GUESTLIST VALIDATION
   */

  async validateGuestlistEligibility(eventId, userId, options = {}) {
    try {
      this.stats.totalValidations++;
      this.stats.validationTypes.guestlist++;

      const validationResult = {
        valid: true,
        errors: [],
        warnings: [],
        requirements: []
      };

      // ✅ Get event and existing guestlist requests
      const [event, existingRequests, userProfile] = await Promise.all([
        this.prisma.event.findUnique({
          where: { id: eventId },
          include: {
            organizer: { select: { id: true, isVerified: true } },
            guestList: { where: { userId }, select: { id: true, status: true } }
          }
        }),
        this.prisma.guestList.count({
          where: { 
            userId,
            createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } // Last 30 days
          }
        }),
        this.prisma.user.findUnique({
          where: { id: userId },
          select: { 
            id: true, 
            isVerified: true, 
            isActive: true,
            createdAt: true
          }
        })
      ]);

      if (!event) {
        validationResult.valid = false;
        validationResult.errors.push({
          field: 'event',
          message: 'Event not found',
          code: 'EVENT_NOT_FOUND'
        });
        return validationResult;
      }

      if (!userProfile) {
        validationResult.valid = false;
        validationResult.errors.push({
          field: 'user',
          message: 'User not found',
          code: 'USER_NOT_FOUND'
        });
        return validationResult;
      }

      // ✅ Check if user already has a guestlist request
      if (event.guestList && event.guestList.length > 0) {
        const existingRequest = event.guestList[0];
        if (existingRequest.status !== 'REJECTED') {
          validationResult.valid = false;
          validationResult.errors.push({
            field: 'guestlist',
            message: `You already have a ${existingRequest.status.toLowerCase()} guestlist request for this event`,
            code: 'DUPLICATE_GUESTLIST_REQUEST'
          });
          return validationResult;
        }
      }

      // ✅ Check guestlist request limit
      if (existingRequests >= this.config.MAX_GUESTLIST_REQUESTS_PER_USER) {
        validationResult.valid = false;
        validationResult.errors.push({
          field: 'guestlist',
          message: `Maximum ${this.config.MAX_GUESTLIST_REQUESTS_PER_USER} guestlist requests per month exceeded`,
          code: 'GUESTLIST_LIMIT_EXCEEDED'
        });
        return validationResult;
      }

      // ✅ Check guestlist deadline
      const eventStart = new Date(event.startDate);
      const guestlistDeadline = new Date(eventStart.getTime() - this.config.GUESTLIST_DEADLINE_HOURS * 60 * 60 * 1000);
      
      if (new Date() > guestlistDeadline) {
        validationResult.valid = false;
        validationResult.errors.push({
          field: 'timing',
          message: `Guestlist requests must be submitted at least ${this.config.GUESTLIST_DEADLINE_HOURS} hours before the event`,
          code: 'GUESTLIST_DEADLINE_PASSED'
        });
        return validationResult;
      }

      // ✅ Event status validation
      await this.validateEventStatus(event, validationResult);

      // ✅ User eligibility validation
      await this.validateUserEligibility(userProfile, validationResult);

      // ✅ Profile completion validation
      const profileValidation = await this.validateUserProfileCompletion(userId, { minimumPercentage: 70 });
      if (!profileValidation.valid) {
        validationResult.requirements.push({
          type: 'PROFILE_COMPLETION',
          message: 'Complete profile required for guestlist requests',
          details: profileValidation.metadata
        });
      }

      // ✅ Update statistics
      if (validationResult.valid) {
        this.stats.successfulValidations++;
      } else {
        this.stats.failedValidations++;
      }

      return validationResult;

    } catch (error) {
      console.error('❌ Guestlist eligibility validation failed:', error);
      this.stats.failedValidations++;
      
      return {
        valid: false,
        errors: [{ field: 'guestlist', message: error.message, code: 'VALIDATION_ERROR' }],
        warnings: [],
        requirements: []
      };
    }
  }

  /**
   * 🛠️ INDIVIDUAL VALIDATION HELPERS
   */

  async validateEventBasicData(eventData, validationResult) {
    // ✅ Title validation
    if (!eventData.title || eventData.title.trim().length < 3) {
      validationResult.valid = false;
      validationResult.errors.push({
        field: 'title',
        message: 'Event title must be at least 3 characters long',
        code: 'INVALID_TITLE'
      });
    }

    // ✅ Description validation
    if (!eventData.description || eventData.description.trim().length < 10) {
      validationResult.warnings.push({
        field: 'description',
        message: 'Event description should be at least 10 characters long for better visibility',
        code: 'SHORT_DESCRIPTION'
      });
    }

    // ✅ Category validation
    const validCategories = ['MUSIC', 'DANCE', 'FESTIVAL', 'CLUB', 'CONCERT', 'PARTY', 'OTHER'];
    if (eventData.category && !validCategories.includes(eventData.category)) {
      validationResult.valid = false;
      validationResult.errors.push({
        field: 'category',
        message: `Invalid category. Must be one of: ${validCategories.join(', ')}`,
        code: 'INVALID_CATEGORY'
      });
    }
  }

  async validateOrganizerEligibility(organizerId, validationResult) {
    const organizer = await this.prisma.user.findUnique({
      where: { id: organizerId },
      select: { 
        id: true, 
        role: true, 
        isVerified: true, 
        isActive: true,
        _count: { select: { events: true } }
      }
    });

    if (!organizer) {
      validationResult.valid = false;
      validationResult.errors.push({
        field: 'organizer',
        message: 'Organizer not found',
        code: 'ORGANIZER_NOT_FOUND'
      });
      return;
    }

    if (organizer.role !== 'ORGANIZER' && organizer.role !== 'ADMIN') {
      validationResult.valid = false;
      validationResult.errors.push({
        field: 'organizer',
        message: 'User does not have organizer privileges',
        code: 'INSUFFICIENT_PRIVILEGES'
      });
      return;
    }

    if (!organizer.isActive) {
      validationResult.valid = false;
      validationResult.errors.push({
        field: 'organizer',
        message: 'Organizer account is inactive',
        code: 'ORGANIZER_INACTIVE'
      });
      return;
    }

    // ✅ Verification requirements for new organizers
    if (this.config.REQUIRE_ORGANIZER_VERIFICATION && 
        !organizer.isVerified && 
        organizer._count.events >= this.config.MIN_ORGANIZER_EVENTS_FOR_VERIFICATION) {
      
      validationResult.requirements.push({
        type: 'ORGANIZER_VERIFICATION',
        message: 'Organizer verification required for creating more events',
        code: 'VERIFICATION_REQUIRED'
      });
    }
  }

  async validateEventTiming(eventData, validationResult) {
    const startDate = new Date(eventData.startDate);
    const endDate = eventData.endDate ? new Date(eventData.endDate) : null;
    const now = new Date();

    // ✅ Start date validation
    const hoursFromNow = (startDate.getTime() - now.getTime()) / (1000 * 60 * 60);
    
    if (hoursFromNow < this.config.MIN_EVENT_ADVANCE_BOOKING_HOURS) {
      validationResult.valid = false;
      validationResult.errors.push({
        field: 'startDate',
        message: `Event must be scheduled at least ${this.config.MIN_EVENT_ADVANCE_BOOKING_HOURS} hours in advance`,
        code: 'INSUFFICIENT_ADVANCE_TIME'
      });
    }

    const daysFromNow = hoursFromNow / 24;
    if (daysFromNow > this.config.MAX_EVENT_ADVANCE_BOOKING_DAYS) {
      validationResult.valid = false;
      validationResult.errors.push({
        field: 'startDate',
        message: `Event cannot be scheduled more than ${this.config.MAX_EVENT_ADVANCE_BOOKING_DAYS} days in advance`,
        code: 'TOO_FAR_IN_ADVANCE'
      });
    }

    // ✅ End date validation
    if (endDate && endDate <= startDate) {
      validationResult.valid = false;
      validationResult.errors.push({
        field: 'endDate',
        message: 'Event end date must be after start date',
        code: 'INVALID_END_DATE'
      });
    }
  }

  async validateEventCapacity(eventData, validationResult) {
    if (eventData.capacity) {
      if (eventData.capacity < this.config.MIN_EVENT_CAPACITY) {
        validationResult.valid = false;
        validationResult.errors.push({
          field: 'capacity',
          message: `Event capacity must be at least ${this.config.MIN_EVENT_CAPACITY}`,
          code: 'CAPACITY_TOO_LOW'
        });
      }

      if (eventData.capacity > this.config.MAX_EVENT_CAPACITY) {
        validationResult.valid = false;
        validationResult.errors.push({
          field: 'capacity',
          message: `Event capacity cannot exceed ${this.config.MAX_EVENT_CAPACITY}`,
          code: 'CAPACITY_TOO_HIGH'
        });
      }
    }
  }

  async validateEventLocation(eventData, validationResult) {
    if (!eventData.location || eventData.location.trim().length < 5) {
      validationResult.warnings.push({
        field: 'location',
        message: 'Event location should be descriptive for better user experience',
        code: 'VAGUE_LOCATION'
      });
    }
  }

  async validateEventStatus(event, validationResult) {
    if (event.status !== 'PUBLISHED') {
      validationResult.valid = false;
      validationResult.errors.push({
        field: 'event',
        message: `Event is ${event.status.toLowerCase()} and not available for booking`,
        code: 'EVENT_NOT_AVAILABLE'
      });
    }
  }

  async validateUserEligibility(user, validationResult) {
    if (!user.isActive) {
      validationResult.valid = false;
      validationResult.errors.push({
        field: 'user',
        message: 'User account is inactive',
        code: 'USER_INACTIVE'
      });
    }

    // ✅ Email verification requirement
    if (this.config.REQUIRE_EMAIL_VERIFICATION && !user.isVerified) {
      validationResult.requirements.push({
        type: 'EMAIL_VERIFICATION',
        message: 'Email verification is required',
        code: 'EMAIL_VERIFICATION_REQUIRED'
      });
    }
  }

  async validateBookingQuantity(eventId, userId, quantity, validationResult) {
    if (quantity > this.config.MAX_TICKETS_PER_BOOKING) {
      validationResult.valid = false;
      validationResult.errors.push({
        field: 'quantity',
        message: `Maximum ${this.config.MAX_TICKETS_PER_BOOKING} tickets per booking`,
        code: 'QUANTITY_EXCEEDED'
      });
    }

    if (quantity < 1) {
      validationResult.valid = false;
      validationResult.errors.push({
        field: 'quantity',
        message: 'Quantity must be at least 1',
        code: 'INVALID_QUANTITY'
      });
    }
  }

  async validateEventAvailability(event, quantity, accessTierId, validationResult) {
    // ✅ Get access tier information
    let accessTier = null;
    if (accessTierId) {
      accessTier = event.accessTiers.find(tier => tier.id === accessTierId);
      if (!accessTier) {
        validationResult.valid = false;
        validationResult.errors.push({
          field: 'accessTier',
          message: 'Access tier not found',
          code: 'ACCESS_TIER_NOT_FOUND'
        });
        return;
      }

      // ✅ Check tier availability
      if (accessTier.availableQuantity < quantity) {
        validationResult.valid = false;
        validationResult.errors.push({
          field: 'capacity',
          message: `Only ${accessTier.availableQuantity} tickets available for ${accessTier.name}`,
          code: 'INSUFFICIENT_CAPACITY'
        });
      }
    }

    // ✅ Check overall event capacity
    if (event.capacity) {
      const totalSold = event.accessTiers.reduce((sum, tier) => sum + tier.soldQuantity, 0);
      if (totalSold + quantity > event.capacity) {
        validationResult.valid = false;
        validationResult.errors.push({
          field: 'capacity',
          message: 'Event is sold out',
          code: 'EVENT_SOLD_OUT'
        });
      }
    }
  }

  async validateNoDuplicateBooking(eventId, userId, validationResult) {
    if (this.config.MAX_BOOKINGS_PER_USER_PER_EVENT === 1) {
      const existingBooking = await this.prisma.booking.findFirst({
        where: {
          eventId,
          userId,
          status: { in: ['PENDING', 'CONFIRMED'] }
        }
      });

      if (existingBooking) {
        validationResult.valid = false;
        validationResult.errors.push({
          field: 'booking',
          message: 'You already have a booking for this event',
          code: 'DUPLICATE_BOOKING'
        });
      }
    }
  }

  async validateBookingTiming(event, validationResult) {
    const eventStart = new Date(event.startDate);
    const now = new Date();
    const hoursUntilEvent = (eventStart.getTime() - now.getTime()) / (1000 * 60 * 60);

    if (hoursUntilEvent < this.config.MIN_EVENT_ADVANCE_BOOKING_HOURS) {
      validationResult.valid = false;
      validationResult.errors.push({
        field: 'timing',
        message: `Booking must be made at least ${this.config.MIN_EVENT_ADVANCE_BOOKING_HOURS} hours before the event`,
        code: 'BOOKING_DEADLINE_PASSED'
      });
    }

    // ✅ Check if event has already started or ended
    if (now >= eventStart) {
      validationResult.valid = false;
      validationResult.errors.push({
        field: 'timing',
        message: 'Cannot book for events that have already started',
        code: 'EVENT_ALREADY_STARTED'
      });
    }
  }

  /**
   * 🔢 UTILITY METHODS
   */

  calculateProfileCompletion(user) {
    const requiredFields = ['firstName', 'lastName', 'email', 'phone'];
    const optionalFields = ['avatar', 'city'];
    const allFields = [...requiredFields, ...optionalFields];

    const completedFields = allFields.filter(field => {
      const value = user[field];
      return value && value.toString().trim().length > 0;
    });

    const missingFields = allFields.filter(field => {
      const value = user[field];
      return !value || value.toString().trim().length === 0;
    });

    let percentage = (completedFields.length / allFields.length) * 100;

    // ✅ Bonus for verification
    if (user.isVerified) percentage += 10;
    if (user.emailVerifiedAt) percentage += 5;
    if (user.phoneVerifiedAt) percentage += 5;

    return {
      percentage: Math.min(100, Math.round(percentage)),
      completedFields,
      missingFields: missingFields.filter(field => !completedFields.includes(field))
    };
  }

  /**
   * 📊 STATISTICS & MONITORING
   */

  getValidationStats() {
    return {
      ...this.stats,
      successRate: this.stats.totalValidations > 0 
        ? ((this.stats.successfulValidations / this.stats.totalValidations) * 100).toFixed(2) + '%'
        : '100%',
      cacheHitRate: this.stats.totalValidations > 0
        ? ((this.stats.cachedResults / this.stats.totalValidations) * 100).toFixed(2) + '%'
        : '0%'
    };
  }

  getHealthStatus() {
    return {
      status: 'healthy',
      totalValidations: this.stats.totalValidations,
      successRate: this.getValidationStats().successRate,
      cacheEnabled: this.config.CACHE_VALIDATION_RESULTS,
      configLoaded: Object.keys(this.config).length > 0
    };
  }

  /**
   * 🧹 CLEANUP
   */
  async cleanup() {
    await this.prisma.$disconnect();
    console.log('✅ BusinessValidationService cleanup completed');
  }
}

module.exports = BusinessValidationService;