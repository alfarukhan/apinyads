const BaseRepository = require('./BaseRepository');
const { getAuditLogService } = require('../services/core');

/**
 * 🎪 EVENT REPOSITORY
 * 
 * Specialized data access for Event model with:
 * - Event lifecycle management (draft → published → ended)
 * - Smart caching for popular events
 * - Capacity management & availability checking
 * - Search & filtering optimization
 * - Geographic location handling
 * - Event analytics & statistics
 * 
 * ✅ Performance: Optimized queries for event discovery
 * ✅ Business Logic: Event-specific validation & rules
 * ✅ Analytics: Event metrics & performance tracking
 */
class EventRepository extends BaseRepository {
  constructor() {
    super('event', {
      enableCaching: true,
      cacheCategory: 'event_cache',
      cacheTTL: 600, // 10 minutes for events
      enableAudit: true,
      supportsSoftDelete: true,
      softDeleteField: 'deletedAt',
      auditableFields: [
        'title', 'description', 'status', 'startDate', 'endDate',
        'location', 'capacity', 'price', 'imageUrl', 'organizerId'
      ]
    });

    // ✅ CENTRALIZED: Use service factory instead of direct instantiation
    this.auditService = getAuditLogService();
  }

  /**
   * 🔍 SPECIALIZED FIND OPERATIONS
   */
  
  async findPublishedEvents(options = {}) {
    const {
      location = null,
      dateFrom = null,
      dateTo = null,
      priceMin = null,
      priceMax = null,
      searchQuery = null,
      category = null,
      page = 1,
      limit = 20,
      sortBy = 'startDate',
      sortOrder = 'asc',
      userId = null
    } = options;

    try {
      // ✅ Build advanced where clause
      const where = {
        status: 'PUBLISHED',
        startDate: { gte: new Date() } // Only future events
      };

      // ✅ Location filter
      if (location) {
        where.location = { contains: location, mode: 'insensitive' };
      }

      // ✅ Date range filter
      if (dateFrom || dateTo) {
        where.startDate = {};
        if (dateFrom) where.startDate.gte = new Date(dateFrom);
        if (dateTo) where.startDate.lte = new Date(dateTo);
      }

      // ✅ Price range filter
      if (priceMin !== null || priceMax !== null) {
        where.OR = [
          { price: null }, // Free events
          {
            price: {
              ...(priceMin !== null && { gte: priceMin }),
              ...(priceMax !== null && { lte: priceMax })
            }
          }
        ];
      }

      // ✅ Search in title and description
      if (searchQuery) {
        where.OR = [
          { title: { contains: searchQuery, mode: 'insensitive' } },
          { description: { contains: searchQuery, mode: 'insensitive' } }
        ];
      }

      // ✅ Category filter
      if (category) {
        where.category = category;
      }

      // ✅ Build order by
      const orderBy = {};
      orderBy[sortBy] = sortOrder;

      const result = await this.findMany({
        where,
        include: {
          organizer: {
            select: { id: true, username: true, firstName: true, lastName: true, avatar: true }
          },
          accessTiers: {
            select: { id: true, name: true, price: true, totalQuantity: true, soldQuantity: true, availableQuantity: true }
          },
          _count: {
            select: { bookings: true, guestList: true }
          }
        },
        orderBy,
        page,
        limit,
        userId
      });

      // ✅ Add computed fields
      result.items = result.items.map(event => ({
        ...event,
        isAvailable: this.checkEventAvailability(event),
        popularity: this.calculatePopularity(event),
        priceRange: this.calculatePriceRange(event.accessTiers)
      }));

      return result;

    } catch (error) {
      console.error('❌ EventRepository.findPublishedEvents error:', error);
      throw error;
    }
  }

  async findEventsByOrganizer(organizerId, options = {}) {
    const {
      status = null,
      includeDeleted = false,
      page = 1,
      limit = 20,
      userId = null
    } = options;

    try {
      const where = { organizerId };
      
      if (status) {
        where.status = status;
      }

      if (!includeDeleted) {
        where.deletedAt = null;
      }

      return await this.findMany({
        where,
        include: {
          accessTiers: {
            select: { id: true, name: true, price: true, totalQuantity: true, soldQuantity: true }
          },
          _count: {
            select: { bookings: true, guestList: true }
          }
        },
        orderBy: { createdAt: 'desc' },
        page,
        limit,
        userId
      });

    } catch (error) {
      console.error('❌ EventRepository.findEventsByOrganizer error:', error);
      throw error;
    }
  }

  async findPopularEvents(options = {}) {
    const {
      limit = 10,
      timeframe = 30, // days
      userId = null
    } = options;

    try {
      const since = new Date(Date.now() - timeframe * 24 * 60 * 60 * 1000);

      const result = await this.findMany({
        where: {
          status: 'PUBLISHED',
          startDate: { gte: new Date() },
          createdAt: { gte: since }
        },
        include: {
          organizer: {
            select: { id: true, username: true, firstName: true, lastName: true }
          },
          _count: {
            select: { bookings: true, guestList: true, views: true }
          }
        },
        orderBy: [
          { bookings: { _count: 'desc' } },
          { views: { _count: 'desc' } },
          { createdAt: 'desc' }
        ],
        page: 1,
        limit,
        userId
      });

      return result;

    } catch (error) {
      console.error('❌ EventRepository.findPopularEvents error:', error);
      throw error;
    }
  }

  async findNearbyEvents(latitude, longitude, radiusKm = 10, options = {}) {
    const { limit = 20, userId = null } = options;

    try {
      // ✅ For now, simple location-based search
      // TODO: Implement proper geographic search with PostGIS or similar
      
      const result = await this.findMany({
        where: {
          status: 'PUBLISHED',
          startDate: { gte: new Date() }
        },
        include: {
          organizer: {
            select: { id: true, username: true, firstName: true, lastName: true }
          }
        },
        orderBy: { startDate: 'asc' },
        page: 1,
        limit,
        userId
      });

      // ✅ TODO: Filter by actual distance calculation
      return result;

    } catch (error) {
      console.error('❌ EventRepository.findNearbyEvents error:', error);
      throw error;
    }
  }

  /**
   * ✨ SPECIALIZED CREATE/UPDATE OPERATIONS
   */
  
  async createEvent(eventData, organizerId, options = {}) {
    const { userId = organizerId } = options;

    try {
      // ✅ Event-specific validation
      const validatedData = await this.validateEventData({
        ...eventData,
        organizerId,
        status: eventData.status || 'DRAFT'
      });

      const event = await this.create(validatedData, {
        include: {
          organizer: {
            select: { id: true, username: true, firstName: true, lastName: true }
          }
        },
        userId
      });

      // ✅ Log event creation
      await this.auditService.logEvent('EVENT_CREATED', {
        userId,
        resourceType: 'event',
        resourceId: event.id,
        metadata: {
          title: event.title,
          status: event.status,
          organizerId: event.organizerId
        }
      });

      return event;

    } catch (error) {
      console.error('❌ EventRepository.createEvent error:', error);
      throw error;
    }
  }

  async updateEventStatus(eventId, status, options = {}) {
    const { userId = null, reason = null } = options;

    try {
      // ✅ Validate status transition
      const currentEvent = await this.findById(eventId);
      if (!currentEvent) {
        throw new Error('Event not found');
      }

      this.validateStatusTransition(currentEvent.status, status);

      const updatedEvent = await this.update(eventId, { status }, {
        include: {
          organizer: {
            select: { id: true, username: true, firstName: true, lastName: true }
          }
        },
        userId
      });

      // ✅ Log status change
      await this.auditService.logEvent('EVENT_STATUS_CHANGED', {
        userId,
        resourceType: 'event',
        resourceId: eventId,
        metadata: {
          oldStatus: currentEvent.status,
          newStatus: status,
          reason: reason || 'No reason provided'
        }
      });

      return updatedEvent;

    } catch (error) {
      console.error('❌ EventRepository.updateEventStatus error:', error);
      throw error;
    }
  }

  async incrementViewCount(eventId, options = {}) {
    const { userId = null, sessionId = null } = options;

    try {
      // ✅ Use raw query for atomic increment
      await this.prisma.$executeRaw`
        UPDATE "Event" SET "viewCount" = "viewCount" + 1 
        WHERE "id" = ${eventId}
      `;

      // ✅ Log view for analytics
      if (userId) {
        await this.auditService.logEvent('EVENT_VIEWED', {
          userId,
          resourceType: 'event',
          resourceId: eventId,
          sessionId,
          metadata: { timestamp: new Date() }
        });
      }

      // ✅ Invalidate cache for this event
      await this.invalidateCache('view', { id: eventId });

      return true;

    } catch (error) {
      console.error('❌ EventRepository.incrementViewCount error:', error);
      return false;
    }
  }

  /**
   * 📊 ANALYTICS & STATISTICS
   */
  
  async getEventStatistics(eventId, options = {}) {
    try {
      const event = await this.model.findUnique({
        where: { id: eventId },
        include: {
          bookings: {
            select: { id: true, quantity: true, totalAmount: true, status: true, createdAt: true }
          },
          guestList: {
            select: { id: true, status: true, isPaid: true, createdAt: true }
          },
          accessTiers: {
            select: { id: true, name: true, totalQuantity: true, soldQuantity: true, price: true }
          }
        }
      });

      if (!event) {
        throw new Error('Event not found');
      }

      // ✅ Calculate statistics
      const confirmedBookings = event.bookings.filter(b => b.status === 'CONFIRMED');
      const paidGuestlist = event.guestList.filter(g => g.isPaid);

      const stats = {
        // Basic metrics
        totalViews: event.viewCount || 0,
        totalBookings: event.bookings.length,
        confirmedBookings: confirmedBookings.length,
        totalRevenue: confirmedBookings.reduce((sum, b) => sum + (b.totalAmount || 0), 0),
        
        // Capacity metrics
        totalCapacity: event.capacity || 0,
        bookedCapacity: confirmedBookings.reduce((sum, b) => sum + b.quantity, 0),
        guestlistCount: paidGuestlist.length,
        
        // Access tier breakdown
        accessTierStats: event.accessTiers.map(tier => ({
          id: tier.id,
          name: tier.name,
          totalQuantity: tier.totalQuantity,
          soldQuantity: tier.soldQuantity,
          availableQuantity: tier.totalQuantity - tier.soldQuantity,
          revenue: tier.soldQuantity * (tier.price || 0),
          sellRate: tier.totalQuantity > 0 ? (tier.soldQuantity / tier.totalQuantity * 100).toFixed(2) : 0
        })),

        // Time-based metrics
        bookingsByDay: this.groupBookingsByDay(event.bookings),
        guestlistByDay: this.groupGuestlistByDay(event.guestList)
      };

      // ✅ Add computed metrics
      stats.occupancyRate = stats.totalCapacity > 0 
        ? ((stats.bookedCapacity / stats.totalCapacity) * 100).toFixed(2)
        : 0;

      stats.conversionRate = stats.totalViews > 0
        ? ((stats.confirmedBookings / stats.totalViews) * 100).toFixed(2)
        : 0;

      return stats;

    } catch (error) {
      console.error('❌ EventRepository.getEventStatistics error:', error);
      throw error;
    }
  }

  /**
   * 🔍 VALIDATION & BUSINESS LOGIC
   */
  
  async validateEventData(data) {
    // ✅ Basic validation
    if (!data.title || data.title.trim().length < 3) {
      throw new Error('Event title must be at least 3 characters long');
    }

    if (!data.startDate) {
      throw new Error('Event start date is required');
    }

    const startDate = new Date(data.startDate);
    const endDate = data.endDate ? new Date(data.endDate) : null;

    if (startDate < new Date()) {
      throw new Error('Event start date must be in the future');
    }

    if (endDate && endDate <= startDate) {
      throw new Error('Event end date must be after start date');
    }

    if (data.capacity && data.capacity < 1) {
      throw new Error('Event capacity must be at least 1');
    }

    if (data.price && data.price < 0) {
      throw new Error('Event price cannot be negative');
    }

    return data;
  }

  validateStatusTransition(currentStatus, newStatus) {
    const allowedTransitions = {
      DRAFT: ['PUBLISHED', 'CANCELLED'],
      PUBLISHED: ['CANCELLED', 'ENDED'],
      CANCELLED: ['DRAFT'], // Can reactivate cancelled drafts
      ENDED: [] // Cannot change ended events
    };

    if (!allowedTransitions[currentStatus]?.includes(newStatus)) {
      throw new Error(`Invalid status transition from ${currentStatus} to ${newStatus}`);
    }
  }

  checkEventAvailability(event) {
    if (event.status !== 'PUBLISHED') return false;
    if (new Date(event.startDate) <= new Date()) return false;
    
    // ✅ Check capacity
    if (event.capacity) {
      const totalBooked = event.accessTiers?.reduce((sum, tier) => sum + tier.soldQuantity, 0) || 0;
      if (totalBooked >= event.capacity) return false;
    }

    return true;
  }

  calculatePopularity(event) {
    const views = event.viewCount || 0;
    const bookings = event._count?.bookings || 0;
          const guestlist = event._count?.guestLists || 0;
    
    // ✅ Simple popularity score
    return (views * 0.1) + (bookings * 10) + (guestlist * 5);
  }

  calculatePriceRange(accessTiers) {
    if (!accessTiers || accessTiers.length === 0) {
      return { min: 0, max: 0, hasFreeTier: true };
    }

    const prices = accessTiers.map(tier => tier.price || 0);
    const min = Math.min(...prices);
    const max = Math.max(...prices);

    return {
      min,
      max,
      hasFreeTier: min === 0
    };
  }

  groupBookingsByDay(bookings) {
    const grouped = {};
    bookings.forEach(booking => {
      const day = booking.createdAt.toISOString().split('T')[0];
      grouped[day] = (grouped[day] || 0) + 1;
    });
    return grouped;
  }

  groupGuestlistByDay(guestlist) {
    const grouped = {};
    guestlist.forEach(guest => {
      const day = guest.createdAt.toISOString().split('T')[0];
      grouped[day] = (grouped[day] || 0) + 1;
    });
    return grouped;
  }
}

module.exports = EventRepository;