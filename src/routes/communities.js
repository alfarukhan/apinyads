const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const { optionalAuth, authMiddleware } = require('../middleware/auth');

const router = express.Router();
// ✅ ENTERPRISE: Use centralized singleton
const { prisma } = require('../lib/prisma');

// ✅ ENTERPRISE: Use centralized user selectors
const userSelectors = require('../lib/user-selectors');

// =====================================
// HELPER FUNCTIONS FOR MULTIPLE ADMINS
// =====================================

/**
 * Check if user is admin of the community
 * Supports multiple admins via CommunityMember role
 */
async function isUserCommunityAdmin(communityId, userId) {
  const membership = await prisma.communityMember.findUnique({
    where: {
      communityId_userId: {
        communityId: communityId,
        userId: userId
      }
    },
    select: { role: true }
  });

  // User is admin if they have ADMIN role in CommunityMember OR are the original admin
  const community = await prisma.community.findUnique({
    where: { id: communityId },
    select: { adminId: true }
  });

  return (membership?.role === 'ADMIN') || (community?.adminId === userId);
}

/**
 * Get all admins of a community
 */
async function getCommunityAdmins(communityId) {
  const [originalAdmin, memberAdmins] = await Promise.all([
    // Original admin (creator)
    prisma.community.findUnique({
      where: { id: communityId },
      include: {
        admin: {
          select: {
            id: true,
            username: true,
            firstName: true,
            lastName: true,
            avatar: true
          }
        }
      }
    }),
    // Member admins
    prisma.communityMember.findMany({
      where: {
        communityId: communityId,
        role: 'ADMIN'
      },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            firstName: true,
            lastName: true,
            avatar: true
          }
        }
      }
    })
  ]);

  const admins = [];
  
  // Add original admin (always admin)
  if (originalAdmin) {
    admins.push({
      ...originalAdmin.admin,
      isOriginalAdmin: true,
      role: 'ADMIN'
    });
  }

  // Add member admins (exclude original admin to avoid duplicates)
  memberAdmins.forEach(member => {
    if (member.userId !== originalAdmin?.adminId) {
      admins.push({
        ...member.user,
        isOriginalAdmin: false,
        role: 'ADMIN'
      });
    }
  });

  return admins;
}

// @route   GET /api/communities
// @desc    Get all communities
// @access  Public
router.get('/', optionalAuth, asyncHandler(async (req, res) => {
  const { page = 1, limit = 10 } = req.query;
  const skip = (parseInt(page) - 1) * parseInt(limit);
  const take = parseInt(limit);

  const [communities, total] = await Promise.all([
    prisma.community.findMany({
      skip,
      take,
      orderBy: { memberCount: 'desc' },
      include: {
        admin: {
          select: {
            id: true,
            username: true,
            firstName: true,
            lastName: true,
            avatar: true,
          }
        }
      }
    }),
    prisma.community.count()
  ]);

  res.json({
    success: true,
    data: {
      communities,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / take),
        totalItems: total,
        itemsPerPage: take,
      }
    }
  });
}));

// @route   POST /api/communities
// @desc    Create a new community
// @access  Private
router.post('/', authMiddleware, asyncHandler(async (req, res) => {
  const { name, description, imageUrl, category, city, isPrivate } = req.body;
  
  // Validation
  if (!name || name.trim().length < 3) {
    throw new AppError('Community name must be at least 3 characters', 400);
  }
  
  if (!description || description.trim().length < 10) {
    throw new AppError('Description must be at least 10 characters', 400);
  }
  
  if (!category) {
    throw new AppError('Category is required', 400);
  }
  
  if (!city || city.trim().length === 0) {
    throw new AppError('City is required', 400);
  }

  // Check if community name already exists
  const existingCommunity = await prisma.community.findFirst({
    where: {
      name: {
        equals: name.trim(),
        mode: 'insensitive'
      }
    }
  });

  if (existingCommunity) {
    throw new AppError('A community with this name already exists', 409);
  }

  try {
    // Use transaction for atomic community + group chat creation
    const result = await prisma.$transaction(async (tx) => {
      // 1. Create community first
      const community = await tx.community.create({
        data: {
          name: name.trim(),
          description: description.trim(),
          imageUrl: imageUrl || null,
          category: category.trim(),
          city: city.trim(),
          isPrivate: isPrivate || false,
          adminId: req.user.id,
          memberCount: 1,
          createdAt: new Date(),
          updatedAt: new Date()
        },
        include: {
          admin: {
            select: {
              id: true,
              username: true,
              firstName: true,
              lastName: true,
              avatar: true,
            }
          }
        }
      });

      // 2. Auto-create group chat for community
      const chatRoom = await tx.chatRoom.create({
        data: {
          name: `${community.name} Group Chat`,
          type: 'GROUP',
          isActive: true,
          members: {
            connect: [{ id: req.user.id }] // Add creator as member
          }
        }
      });

      // 3. Update community with chatRoomId
      const updatedCommunity = await tx.community.update({
        where: { id: community.id },
        data: { chatRoomId: chatRoom.id },
        include: {
          admin: {
            select: {
              id: true,
              username: true,
              firstName: true,
              lastName: true,
              avatar: true,
            }
          },
          chatRoom: {
            select: {
              id: true,
              name: true,
              type: true
            }
          }
        }
      });

      // 4. Create community member with ADMIN role
      await tx.communityMember.create({
        data: {
          communityId: community.id,
          userId: req.user.id,
          role: 'ADMIN'
        }
      });

      return { community: updatedCommunity, chatRoom };
    });

    console.log(`✅ Community created: ${result.community.name} by user ${req.user.id} (role: ADMIN)`);
    console.log(`✅ Group chat created: ${result.chatRoom.id} for community ${result.community.id}`);

    res.status(201).json({
      success: true,
      data: result.community,
      message: 'Community and group chat created successfully'
    });
  } catch (error) {
    console.error('❌ Error creating community:', error);
    throw new AppError('Failed to create community', 500);
  }
}));

// @route   GET /api/communities/my-communities  
// @desc    Get user's joined communities
// @access  Private (must be before /:id route)
router.get('/my-communities', authMiddleware, asyncHandler(async (req, res) => {
  const userId = req.user.id;

  const memberships = await prisma.communityMember.findMany({
    where: { userId },
    include: {
      community: {
        include: {
          admin: {
            select: {
              id: true,
              username: true,
              firstName: true,
              lastName: true,
              avatar: true,
            }
          },
          _count: {
            select: {
              members: true
            }
          }
        }
      }
    },
    orderBy: { joinedAt: 'desc' }
  });

  const communities = memberships.map(membership => ({
    ...membership.community,
    memberCount: membership.community._count.members,
    isJoined: true,
    userRole: membership.role
  }));

  res.json({
    success: true,
    data: communities
  });
}));

// @route   GET /api/communities/:id
// @desc    Get single community by ID
// @access  Public
router.get('/:id', optionalAuth, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const userId = req.user?.id;

  const community = await prisma.community.findUnique({
    where: { id },
    include: {
      admin: {
        select: {
          id: true,
          username: true,
          firstName: true,
          lastName: true,
          avatar: true,
        }
      },
      _count: {
        select: {
          members: true
        }
      }
    }
  });

  if (!community) {
    throw new AppError('Community not found', 404);
  }

  // Check if current user is member (including admin)
  let isJoined = false;
  let userRole = null;
  if (userId) {
    const membership = await prisma.communityMember.findUnique({
      where: {
        communityId_userId: {
          communityId: id,
          userId: userId
        }
      }
    });
    
    // ✅ FIXED: Fallback logic for creator/admin
    if (membership) {
      isJoined = true;
      userRole = membership.role;
    } else if (userId === community.adminId) {
      // Creator is always joined with ADMIN role, even without CommunityMember record
      isJoined = true;
      userRole = 'ADMIN';
      
      // Auto-create missing CommunityMember record for creator
      try {
        await prisma.communityMember.create({
          data: {
            communityId: id,
            userId: userId,
            role: 'ADMIN'
          }
        });
        console.log(`✅ Auto-created missing CommunityMember for creator ${userId}`);
      } catch (e) {
        // Ignore if already exists (race condition)
        console.log(`ℹ️ CommunityMember already exists for creator ${userId}`);
      }
    }
    
    // 🔥 DEBUG: Log membership check
    console.log('🔥 BACKEND MEMBERSHIP CHECK:');
    console.log('  User ID:', userId);
    console.log('  Community ID:', id);
    console.log('  Community adminId:', community.adminId);
    console.log('  Membership found:', !!membership);
    console.log('  User role:', userRole);
    console.log('  Is joined:', isJoined);
    console.log('  Is creator:', userId === community.adminId);
  }

  // Update member count to real count from database
  const realMemberCount = community._count.members;
  
  // Update community member count if different
  if (community.memberCount !== realMemberCount) {
    await prisma.community.update({
      where: { id },
      data: { memberCount: realMemberCount }
    });
  }

  // ✅ NEW APPROACH: Include user role for role-based admin check
  const responseData = {
    id: community.id,
    name: community.name,
    description: community.description,
    imageUrl: community.imageUrl,
    category: community.category,
    city: community.city,
    isPrivate: community.isPrivate,
    adminId: community.adminId, // Keep for backward compatibility
    admin: {
      id: community.admin.id,
      username: community.admin.username,
      firstName: community.admin.firstName,
      lastName: community.admin.lastName,
      avatar: community.admin.avatar
    },
    memberCount: realMemberCount,
    createdAt: community.createdAt,
    updatedAt: community.updatedAt,
    isJoined,
    userRole: userRole, // NEW: Current user's role in community (ADMIN, MEMBER, null)
    // Community Group Chat Info
    chatRoomId: community.chatRoomId,
    chatRoomName: community.chatRoomId ? `${community.name} Group Chat` : null
  };

  res.json({
    success: true,
    data: responseData
  });
}));

// @route   GET /api/communities/:id/members
// @desc    Get community members
// @access  Public
router.get('/:id/members', optionalAuth, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { page = 1, limit = 20 } = req.query;
  const skip = (parseInt(page) - 1) * parseInt(limit);
  const take = parseInt(limit);

  // Check if community exists
  const community = await prisma.community.findUnique({
    where: { id }
  });

  if (!community) {
    throw new AppError('Community not found', 404);
  }

  const [members, total] = await Promise.all([
    prisma.communityMember.findMany({
      where: { communityId: id },
      skip,
      take,
      orderBy: { joinedAt: 'asc' }, // Admin first
      include: {
        user: {
          select: {
            id: true,
            username: true,
            firstName: true,
            lastName: true,
            avatar: true,
            city: true,
          }
        }
      }
    }),
    prisma.communityMember.count({
      where: { communityId: id }
    })
  ]);

  const formattedMembers = members.map(member => ({
    id: member.user.id,
    firstName: member.user.firstName,
    lastName: member.user.lastName,
    username: member.user.username,
    avatar: member.user.avatar,
    city: member.user.city,
    role: member.role,
    joinedAt: member.joinedAt,
    isAdmin: member.role === 'ADMIN'
  }));

  res.json({
    success: true,
    data: formattedMembers,
    pagination: {
      currentPage: parseInt(page),
      totalPages: Math.ceil(total / take),
      totalItems: total,
      itemsPerPage: take,
    }
  });
}));

// @route   POST /api/communities/:id/join
// @desc    Join a community
// @access  Private
router.post('/:id/join', authMiddleware, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  // Check if community exists and get chat room info
  const community = await prisma.community.findUnique({
    where: { id },
    include: {
      chatRoom: true
    }
  });

  if (!community) {
    throw new AppError('Community not found', 404);
  }

  // Check if user is already a member (including admin)
  const existingMembership = await prisma.communityMember.findUnique({
    where: {
      communityId_userId: {
        communityId: id,
        userId: userId
      }
    }
  });

  if (existingMembership) {
    if (existingMembership.role === 'ADMIN') {
      throw new AppError('You are the admin of this community', 400);
    } else {
      throw new AppError('You are already a member of this community', 400);
    }
  }

  // Use transaction for atomic community join + chat room join
  await prisma.$transaction(async (tx) => {
    // 1. Add user as community member
    await tx.communityMember.create({
      data: {
        userId: userId,
        communityId: id,
        role: 'MEMBER',
        joinedAt: new Date()
      }
    });

    // 2. Auto-add user to community group chat
    if (community.chatRoomId) {
      await tx.chatRoom.update({
        where: { id: community.chatRoomId },
        data: {
          members: {
            connect: [{ id: userId }]
          }
        }
      });
    }

    // 3. Update community member count
    const memberCount = await tx.communityMember.count({
      where: { communityId: id }
    });

    await tx.community.update({
      where: { id },
      data: { memberCount }
    });
  });

  console.log(`✅ User ${userId} joined community ${community.name}`);
  console.log(`✅ User ${userId} added to community group chat ${community.chatRoomId}`);

  res.json({
    success: true,
    message: `Successfully joined ${community.name}`
  });
}));

// @route   DELETE /api/communities/:id/leave
// @desc    Leave a community
// @access  Private
router.delete('/:id/leave', authMiddleware, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  // Check if community exists and get chat room info
  const community = await prisma.community.findUnique({
    where: { id },
    include: {
      chatRoom: true
    }
  });

  if (!community) {
    throw new AppError('Community not found', 404);
  }

  // Check if user is a member
  const membership = await prisma.communityMember.findUnique({
    where: {
      communityId_userId: {
        communityId: id,
        userId: userId
      }
    }
  });

  if (!membership) {
    throw new AppError('You are not a member of this community', 400);
  }

  // Admin cannot leave their own community
  if (membership.role === 'ADMIN') {
    throw new AppError('Community admin cannot leave their own community', 400);
  }

  // Use transaction for atomic community leave + chat room leave
  await prisma.$transaction(async (tx) => {
    // 1. Remove user from community
    await tx.communityMember.delete({
      where: {
        communityId_userId: {
          communityId: id,
          userId: userId
        }
      }
    });

    // 2. Auto-remove user from community group chat
    if (community.chatRoomId) {
      await tx.chatRoom.update({
        where: { id: community.chatRoomId },
        data: {
          members: {
            disconnect: [{ id: userId }]
          }
        }
      });
    }

    // 3. Update community member count
    const memberCount = await tx.communityMember.count({
      where: { communityId: id }
    });

    await tx.community.update({
      where: { id },
      data: { memberCount }
    });
  });

  console.log(`✅ User ${userId} left community ${community.name}`);
  console.log(`✅ User ${userId} removed from community group chat ${community.chatRoomId}`);

  res.json({
    success: true,
    message: `Successfully left ${community.name}`
  });
}));

// =====================================
// COMMUNITY TOPIC MANAGEMENT APIs
// =====================================

// @route   POST /api/communities/:id/topics
// @desc    Create a new topic for community group chat (Admin only)
// @access  Private
router.post('/:id/topics', authMiddleware, asyncHandler(async (req, res) => {
  const { id: communityId } = req.params;
  const { title, description, iconEmoji } = req.body;
  const userId = req.user.id;

  // Validation
  if (!title || title.trim().length < 2) {
    throw new AppError('Topic title must be at least 2 characters', 400);
  }

  // Check if community exists and user is admin
  const community = await prisma.community.findUnique({
    where: { id: communityId },
    include: {
      members: {
        where: { userId: userId },
        select: { role: true }
      },
      chatRoom: true
    }
  });

  if (!community) {
    throw new AppError('Community not found', 404);
  }

  if (!community.chatRoomId) {
    throw new AppError('Community does not have a group chat', 400);
  }

  // Check if user is community admin (supports multiple admins)
  const isAdmin = await isUserCommunityAdmin(communityId, userId);
  if (!isAdmin) {
    throw new AppError('Only community admins can create topics', 403);
  }

  // Create topic
  const topic = await prisma.chatTopic.create({
    data: {
      title: title.trim(),
      description: description?.trim() || null,
      iconEmoji: iconEmoji || null,
      chatRoomId: community.chatRoomId,
      createdById: userId
    },
    include: {
      createdBy: {
        select: {
          id: true,
          username: true,
          firstName: true,
          lastName: true
        }
      }
    }
  });

  console.log(`✅ Topic created: ${topic.title} in community ${community.name} by ${userId}`);

  res.status(201).json({
    success: true,
    data: topic,
    message: 'Topic created successfully'
  });
}));

// @route   GET /api/communities/:id/topics
// @desc    Get all topics for community group chat
// @access  Private (Community members only)
router.get('/:id/topics', authMiddleware, asyncHandler(async (req, res) => {
  const { id: communityId } = req.params;
  const userId = req.user.id;

  // Check if community exists and user is member
  const community = await prisma.community.findUnique({
    where: { id: communityId },
    include: {
      members: {
        where: { userId: userId },
        select: { role: true }
      },
      chatRoom: {
        include: {
          topics: {
            orderBy: [
              { isPinned: 'desc' },
              { createdAt: 'asc' }
            ],
            include: {
              createdBy: {
                select: {
                  id: true,
                  username: true,
                  firstName: true,
                  lastName: true
                }
              },
              _count: {
                select: { messages: true }
              }
            }
          }
        }
      }
    }
  });

  if (!community) {
    throw new AppError('Community not found', 404);
  }

  // Check if user is community member
  if (!community.members.length) {
    throw new AppError('You are not a member of this community', 403);
  }

  if (!community.chatRoom) {
    return res.json({
      success: true,
      data: [],
      message: 'Community does not have group chat yet'
    });
  }

  // Format topics with message count
  const topics = community.chatRoom.topics.map(topic => ({
    ...topic,
    messageCount: topic._count.messages
  }));

  res.json({
    success: true,
    data: topics
  });
}));

// @route   PUT /api/communities/:id/topics/:topicId
// @desc    Update topic (Admin only)
// @access  Private
router.put('/:id/topics/:topicId', authMiddleware, asyncHandler(async (req, res) => {
  const { id: communityId, topicId } = req.params;
  const { title, description, iconEmoji, isPinned, isLocked } = req.body;
  const userId = req.user.id;

  // Check if community exists and user is admin
  const community = await prisma.community.findUnique({
    where: { id: communityId },
    include: {
      members: {
        where: { userId: userId },
        select: { role: true }
      }
    }
  });

  if (!community) {
    throw new AppError('Community not found', 404);
  }

  // Check if user is community admin (supports multiple admins)
  const isAdmin = await isUserCommunityAdmin(communityId, userId);
  if (!isAdmin) {
    throw new AppError('Only community admins can update topics', 403);
  }

  // Check if topic exists and belongs to this community
  const existingTopic = await prisma.chatTopic.findFirst({
    where: {
      id: topicId,
      chatRoom: {
        community: {
          id: communityId
        }
      }
    }
  });

  if (!existingTopic) {
    throw new AppError('Topic not found', 404);
  }

  // Update topic
  const updatedTopic = await prisma.chatTopic.update({
    where: { id: topicId },
    data: {
      ...(title && { title: title.trim() }),
      ...(description !== undefined && { description: description?.trim() || null }),
      ...(iconEmoji !== undefined && { iconEmoji: iconEmoji || null }),
      ...(isPinned !== undefined && { isPinned: Boolean(isPinned) }),
      ...(isLocked !== undefined && { isLocked: Boolean(isLocked) })
    },
    include: {
      createdBy: {
        select: {
          id: true,
          username: true,
          firstName: true,
          lastName: true
        }
      }
    }
  });

  console.log(`✅ Topic updated: ${updatedTopic.title} in community ${community.name} by ${userId}`);

  res.json({
    success: true,
    data: updatedTopic,
    message: 'Topic updated successfully'
  });
}));

// @route   DELETE /api/communities/:id/topics/:topicId
// @desc    Delete topic (Admin only)
// @access  Private
router.delete('/:id/topics/:topicId', authMiddleware, asyncHandler(async (req, res) => {
  const { id: communityId, topicId } = req.params;
  const userId = req.user.id;

  // Check if community exists and user is admin
  const community = await prisma.community.findUnique({
    where: { id: communityId },
    include: {
      members: {
        where: { userId: userId },
        select: { role: true }
      }
    }
  });

  if (!community) {
    throw new AppError('Community not found', 404);
  }

  // Check if user is community admin (supports multiple admins)
  const isAdmin = await isUserCommunityAdmin(communityId, userId);
  if (!isAdmin) {
    throw new AppError('Only community admins can delete topics', 403);
  }

  // Check if topic exists and belongs to this community
  const existingTopic = await prisma.chatTopic.findFirst({
    where: {
      id: topicId,
      chatRoom: {
        community: {
          id: communityId
        }
      }
    }
  });

  if (!existingTopic) {
    throw new AppError('Topic not found', 404);
  }

  // Delete topic (this will also delete associated messages due to CASCADE)
  await prisma.chatTopic.delete({
    where: { id: topicId }
  });

  console.log(`✅ Topic deleted: ${existingTopic.title} from community ${community.name} by ${userId}`);

  res.json({
    success: true,
    message: 'Topic deleted successfully'
  });
}));

// =====================================
// COMMUNITY MEMBER MANAGEMENT APIs
// =====================================

// @route   PUT /api/communities/:id/members/:memberId/role
// @desc    Update member role (promote/demote) - Admin only
// @access  Private
router.put('/:id/members/:memberId/role', authMiddleware, asyncHandler(async (req, res) => {
  const { id: communityId, memberId } = req.params;
  const { role } = req.body;
  const userId = req.user.id;

  // Validate role
  if (!['MEMBER', 'MODERATOR', 'ADMIN'].includes(role)) {
    throw new AppError('Invalid role. Must be MEMBER, MODERATOR, or ADMIN', 400);
  }

  // Check if current user is admin
  const isAdmin = await isUserCommunityAdmin(communityId, userId);
  if (!isAdmin) {
    throw new AppError('Only community admins can change member roles', 403);
  }

  // Check if community exists
  const community = await prisma.community.findUnique({
    where: { id: communityId },
    select: { adminId: true }
  });

  if (!community) {
    throw new AppError('Community not found', 404);
  }

  // Prevent changing original admin's role
  if (memberId === community.adminId) {
    throw new AppError('Cannot change the role of the original community admin', 400);
  }

  // Check if member exists
  const existingMember = await prisma.communityMember.findUnique({
    where: {
      communityId_userId: {
        communityId: communityId,
        userId: memberId
      }
    },
    include: {
      user: {
        select: {
          id: true,
          username: true,
          firstName: true,
          lastName: true,
          avatar: true
        }
      }
    }
  });

  if (!existingMember) {
    throw new AppError('Member not found in this community', 404);
  }

  // Update member role
  const updatedMember = await prisma.communityMember.update({
    where: {
      communityId_userId: {
        communityId: communityId,
        userId: memberId
      }
    },
    data: { role: role },
    include: {
      user: {
        select: {
          id: true,
          username: true,
          firstName: true,
          lastName: true,
          avatar: true
        }
      }
    }
  });

  const memberName = `${updatedMember.user.firstName} ${updatedMember.user.lastName}`.trim() 
    || updatedMember.user.username;

  console.log(`✅ Member role updated: ${memberName} is now ${role} in community ${communityId} by ${userId}`);

  res.json({
    success: true,
    data: {
      id: updatedMember.user.id,
      name: memberName,
      role: updatedMember.role,
      updatedAt: updatedMember.joinedAt
    },
    message: `${memberName} is now ${role.toLowerCase()}`
  });
}));

// @route   GET /api/communities/:id/admins
// @desc    Get all admins of a community
// @access  Private (Community members only)
router.get('/:id/admins', authMiddleware, asyncHandler(async (req, res) => {
  const { id: communityId } = req.params;
  const userId = req.user.id;

  // Check if user is community member
  const membership = await prisma.communityMember.findUnique({
    where: {
      communityId_userId: {
        communityId: communityId,
        userId: userId
      }
    }
  });

  if (!membership) {
    throw new AppError('You are not a member of this community', 403);
  }

  // Get all admins
  const admins = await getCommunityAdmins(communityId);

  res.json({
    success: true,
    data: admins
  });
}));

module.exports = router; 