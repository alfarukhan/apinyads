const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { authMiddleware, optionalAuth } = require('../middleware/auth');
const { paginatedResponse, errorResponse } = require('../lib/response-formatters');
const { generateNewsSlug } = require('../utils/slug-generator');

const router = express.Router();
// ✅ ENTERPRISE: Use centralized singleton
const { prisma } = require('../lib/prisma');

// ✅ ENTERPRISE: Use centralized user selectors
const userSelectors = require('../lib/user-selectors');


// Get all news articles
router.get('/', optionalAuth, async (req, res) => {
  try {
    const {
      category,
      tag,
      search,
      page = 1,
      limit = 20,
      sortBy = 'publishedDate',
      sortOrder = 'desc'
    } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);

    const where = {};

    if (category) {
      where.category = {
        contains: category,
        mode: 'insensitive'
      };
    }

    if (tag) {
      where.tags = {
        has: tag
      };
    }

    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { summary: { contains: search, mode: 'insensitive' } },
        { content: { contains: search, mode: 'insensitive' } }
      ];
    }

    const orderBy = { [sortBy]: sortOrder };

    const [articles, total] = await Promise.all([
      prisma.news.findMany({
        where,
        orderBy,
        skip: offset,
        take: parseInt(limit),
        include: {
          comments: {
            take: 3,
            orderBy: { createdAt: 'desc' }
          }
        }
      }),
      prisma.news.count({ where })
    ]);

    // ✅ ENTERPRISE: Use standardized response format
    res.json(paginatedResponse(
      { articles },
      {
        page: parseInt(page),
        lastPage: Math.ceil(total / parseInt(limit)),
        limit: parseInt(limit),
        total,
        hasNext: offset + parseInt(limit) < total,
        hasPrevious: parseInt(page) > 1
      },
      'News articles retrieved successfully'
    ));
  } catch (error) {
    console.error('Error fetching news:', error);
    // ✅ ENTERPRISE: Use standardized error response format
    res.status(500).json(errorResponse(
      'Failed to fetch news',
      [error.message]
    ));
  }
});

// Get single news article
router.get('/:identifier', optionalAuth, async (req, res) => {
  try {
    const identifier = req.params.identifier;
    const userId = req.user?.id; // Optional user from optionalAuth

    // Helper function to check if identifier is a valid CUID (starts with 'c')
    const isCuid = (str) => /^c[a-z0-9]{24,}$/i.test(str);
    
    // Build query based on whether identifier is ID or slug
    const whereClause = isCuid(identifier) 
      ? { id: identifier } 
      : { slug: identifier };

    const article = await prisma.news.findUnique({
      where: whereClause,
      include: {
        comments: {
          orderBy: { createdAt: 'desc' },
          take: 50,
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
        }
      }
    });

    if (!article) {
      return res.status(404).json({
        success: false,
        message: 'Article not found'
      });
    }

    // Check if current user liked this article
    let isLiked = false;
    if (userId) {
      const userLike = await prisma.userNewsLike.findUnique({
        where: {
          userId_newsId: {
            userId: userId,
            newsId: article.id
          }
        }
      });
      isLiked = !!userLike;
    }

    res.status(200).json({
      success: true,
      data: {
        ...article,
        isLiked: isLiked
      }
    });
  } catch (error) {
    console.error('Error fetching article:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch article',
      error: error.message
    });
  }
});

// Like/unlike an article
router.post('/:identifier/like', authMiddleware, async (req, res) => {
  try {
    const identifier = req.params.identifier;
    const userId = req.user.id;

    // Helper function to check if identifier is a valid CUID
    const isCuid = (str) => /^c[a-z0-9]{24,}$/i.test(str);
    
    // Build query based on whether identifier is ID or slug
    const whereClause = isCuid(identifier) 
      ? { id: identifier } 
      : { slug: identifier };

    const article = await prisma.news.findUnique({
      where: whereClause
    });

    if (!article) {
      return res.status(404).json({
        success: false,
        message: 'Article not found'
      });
    }

    // Check if user already liked this article
    const existingLike = await prisma.userNewsLike.findUnique({
      where: {
        userId_newsId: {
          userId: userId,
          newsId: article.id
        }
      }
    });

    let isLiked;
    let newLikesCount;

    if (existingLike) {
      // Unlike: Remove like and decrement count
      await prisma.$transaction([
        prisma.userNewsLike.delete({
          where: { id: existingLike.id }
        }),
        prisma.news.update({
          where: { id: article.id },
          data: { likesCount: { decrement: 1 } }
        })
      ]);
      isLiked = false;
      newLikesCount = Math.max(0, article.likesCount - 1);
    } else {
      // Like: Create like and increment count
      await prisma.$transaction([
        prisma.userNewsLike.create({
          data: {
            userId: userId,
            newsId: article.id
          }
        }),
        prisma.news.update({
          where: { id: article.id },
          data: { likesCount: { increment: 1 } }
        })
      ]);
      isLiked = true;
      newLikesCount = article.likesCount + 1;
    }

    res.status(200).json({
      success: true,
      message: isLiked ? 'Article liked' : 'Article unliked',
      data: { 
        likesCount: newLikesCount,
        isLiked: isLiked
      }
    });
  } catch (error) {
    console.error('Error liking article:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to like article',
      error: error.message
    });
  }
});

// Add comment to article
router.post('/:identifier/comments', authMiddleware, async (req, res) => {
  try {
    const identifier = req.params.identifier;
    const { content } = req.body;
    const userId = req.user.id;

    // ✅ SECURITY: Input validation
    if (!content || typeof content !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'Comment content is required'
      });
    }

    // ✅ SECURITY: Content length validation
    const trimmedContent = content.trim();
    if (trimmedContent.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Comment cannot be empty'
      });
    }

    if (trimmedContent.length > 1000) {
      return res.status(400).json({
        success: false,
        message: 'Comment cannot exceed 1000 characters'
      });
    }

    // ✅ SECURITY: Basic XSS prevention (strip HTML tags)
    const sanitizedContent = trimmedContent.replace(/<[^>]*>/g, '');

    // ✅ SECURITY: Rate limiting check (can add more sophisticated rate limiting later)
    const recentComments = await prisma.newsComment.count({
      where: {
        author: userId,
        createdAt: {
          gte: new Date(Date.now() - 60000) // Last minute
        }
      }
    });

    if (recentComments >= 5) {
      return res.status(429).json({
        success: false,
        message: 'Too many comments. Please wait before commenting again.'
      });
    }

    if (!content || content.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Comment content is required'
      });
    }

    // Helper function to check if identifier is a valid CUID
    const isCuid = (str) => /^c[a-z0-9]{24,}$/i.test(str);
    
    // Build query based on whether identifier is ID or slug
    const whereClause = isCuid(identifier) 
      ? { id: identifier } 
      : { slug: identifier };

    const article = await prisma.news.findUnique({
      where: whereClause
    });

    if (!article) {
      return res.status(404).json({
        success: false,
        message: 'Article not found'
      });
    }

    // Create comment and increment comment count
    const [comment] = await prisma.$transaction([
      prisma.newsComment.create({
        data: {
          content: sanitizedContent,
          author: `${req.user.firstName} ${req.user.lastName}`.trim() || req.user.username,
          userId: userId, // Store user ID for relation
          newsId: article.id,
          createdAt: new Date() // Explicitly set current timestamp
        }
      }),
      prisma.news.update({
        where: { id: article.id },
        data: {
          commentsCount: {
            increment: 1
          }
        }
      })
    ]);

    // Get user data for avatar
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { 
        id: true,
        username: true, 
        firstName: true, 
        lastName: true, 
        avatar: true 
      }
    });

    // Log comment creation timestamp
    console.log('💬 Comment created at:', comment.createdAt);
    console.log('💬 Current time:', new Date());

    res.status(201).json({
      success: true,
      message: 'Comment added successfully',
      data: {
        ...comment,
        user: user
      }
    });
  } catch (error) {
    console.error('Error adding comment:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add comment',
      error: error.message
    });
  }
});

// Create new news article
router.post('/', authMiddleware, async (req, res) => {
  try {
    const {
      title,
      summary,
      content,
      imageUrl,
      author,
      category,
      tags = [],
      readTime,
      publishedDate
    } = req.body;

    // Validation
    if (!title || !content || !author || !category) {
      return res.status(400).json({
        success: false,
        message: 'Title, content, author, and category are required'
      });
    }

    // Generate slug from title
    const generateSlug = (text) => {
      return text
        .toLowerCase()
        .trim()
        .replace(/[^\w\s-]/g, '') // Remove special characters
        .replace(/[\s_-]+/g, '-') // Replace spaces and underscores with hyphens
        .replace(/^-+|-+$/g, ''); // Remove leading/trailing hyphens
    };

    const baseSlug = generateSlug(title);
    
    // Ensure slug is unique
    let uniqueSlug = baseSlug;
    let counter = 1;
    while (true) {
      const existingArticle = await prisma.news.findUnique({
        where: { slug: uniqueSlug }
      });
      
      if (!existingArticle) break;
      
      uniqueSlug = `${baseSlug}-${counter}`;
      counter++;
    }

    // Log timestamp debugging
    console.log('📅 Creating article with publishedDate:', publishedDate);
    console.log('📅 Parsed publishedDate:', publishedDate ? new Date(publishedDate) : new Date());
    console.log('📅 Current time:', new Date());

    const article = await prisma.news.create({
      data: {
        title: title.trim(),
        slug: uniqueSlug,
        summary: summary?.trim(),
        content: content.trim(),
        imageUrl: imageUrl?.trim(),
        author: author.trim(),
        category: category.trim(),
        tags: Array.isArray(tags) ? tags.filter(Boolean) : [],
        readTime: readTime ? parseInt(readTime) : 5,
        likesCount: 0,
        commentsCount: 0,
        publishedDate: new Date(), // Always use current time for published articles
        createdAt: new Date(),
        updatedAt: new Date()
      }
    });

    res.status(201).json({
      success: true,
      message: 'News article created successfully',
      data: article
    });
  } catch (error) {
    console.error('Error creating news article:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create news article',
      error: error.message
    });
  }
});

// Update news article
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const articleId = req.params.id;
    const {
      title,
      summary,
      content,
      imageUrl,
      author,
      category,
      tags,
      readTime,
      publishedDate
    } = req.body;

    const existingArticle = await prisma.news.findUnique({
      where: { id: articleId }
    });

    if (!existingArticle) {
      return res.status(404).json({
        success: false,
        message: 'Article not found'
      });
    }

    const updateData = {};
    if (title !== undefined) updateData.title = title.trim();
    if (summary !== undefined) updateData.summary = summary?.trim();
    if (content !== undefined) updateData.content = content.trim();
    if (imageUrl !== undefined) updateData.imageUrl = imageUrl?.trim();
    if (author !== undefined) updateData.author = author.trim();
    if (category !== undefined) updateData.category = category.trim();
    if (tags !== undefined) updateData.tags = Array.isArray(tags) ? tags.filter(Boolean) : [];
    if (readTime !== undefined) updateData.readTime = parseInt(readTime);
    if (publishedDate !== undefined) updateData.publishedDate = new Date(publishedDate);

    const article = await prisma.news.update({
      where: { id: articleId },
      data: updateData
    });

    res.status(200).json({
      success: true,
      message: 'News article updated successfully',
      data: article
    });
  } catch (error) {
    console.error('Error updating news article:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update news article',
      error: error.message
    });
  }
});

// Delete news article
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const articleId = req.params.id;

    const existingArticle = await prisma.news.findUnique({
      where: { id: articleId }
    });

    if (!existingArticle) {
      return res.status(404).json({
        success: false,
        message: 'Article not found'
      });
    }

    // Delete associated comments first
    await prisma.newsComment.deleteMany({
      where: { newsId: articleId }
    });

    // Delete the article
    await prisma.news.delete({
      where: { id: articleId }
    });

    res.status(200).json({
      success: true,
      message: 'News article deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting news article:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete news article',
      error: error.message
    });
  }
});

// Get trending news
router.get('/trending/articles', optionalAuth, async (req, res) => {
  try {
    const { limit = 10 } = req.query;

    const articles = await prisma.news.findMany({
      orderBy: [
        { likesCount: 'desc' },
        { commentsCount: 'desc' },
        { publishedDate: 'desc' }
      ],
      take: parseInt(limit),
      where: {
        publishedDate: {
          gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) // Last 7 days
        }
      }
    });

    res.status(200).json({
      success: true,
      data: {
        articles
      }
    });
  } catch (error) {
    console.error('Error fetching trending news:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch trending news',
      error: error.message
    });
  }
});

// Get categories
router.get('/categories/list', optionalAuth, async (req, res) => {
  try {
    const categories = await prisma.news.findMany({
      select: {
        category: true
      },
      distinct: ['category']
    });

    const categoryList = categories.map(item => item.category).filter(Boolean);

    res.status(200).json({
      success: true,
      data: {
        categories: categoryList
      }
    });
  } catch (error) {
    console.error('Error fetching categories:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch categories',
      error: error.message
    });
  }
});

module.exports = router;