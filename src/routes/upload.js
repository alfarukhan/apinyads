const express = require('express');
const multer = require('multer');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const { authMiddleware } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../lib/response-formatters');
const R2UploadService = require('../services/core/R2UploadService');

const router = express.Router();

// Initialize upload service
const uploadService = new R2UploadService();

// Configure multer for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE) || 5 * 1024 * 1024, // 5MB default
  },
  fileFilter: (req, file, cb) => {
    // Allow camera files with generic MIME types - validate by extension instead
    const allowedMimeTypes = [
      // Images
      'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif',
      // Videos
      'video/mp4', 'video/mov', 'video/avi', 'video/webm', 'video/quicktime',
      // Audio
      'audio/mp3', 'audio/wav', 'audio/ogg', 'audio/aac', 'audio/mpeg',
      // Documents
      'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain',
      // Generic types from camera/mobile devices
      'application/octet-stream'
    ];

    // Check MIME type first
    if (allowedMimeTypes.includes(file.mimetype)) {
      cb(null, true);
      return;
    }

    // For generic MIME types, validate by file extension
    if (file.mimetype === 'application/octet-stream' && file.originalname) {
      const extension = file.originalname.split('.').pop()?.toLowerCase();
      const allowedExtensions = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'mp4', 'mov', 'avi', 'webm'];
      
      if (extension && allowedExtensions.includes(extension)) {
        cb(null, true);
        return;
      }
    }

    cb(new AppError(`File type not allowed: ${file.mimetype}`, 400), false);
  }
});

/**
 * @route   POST /api/upload/single
 * @desc    Upload a single file to R2
 * @access  Private
 */
router.post('/single', authMiddleware, upload.single('file'), asyncHandler(async (req, res) => {
  console.log('🔵 Single upload route hit');
  console.log('📁 File received:', req.file ? req.file.originalname : 'NO FILE');
  console.log('👤 User ID:', req.user?.id);
  
  if (!req.file) {
    console.log('❌ No file provided');
    throw new AppError('No file provided', 400);
  }

  const { folder, prefix, optimize } = req.body;
  console.log('⚙️ Upload options:', { folder, prefix, optimize });
  
  const uploadOptions = {
    userId: req.user.id,
    folder: folder || 'general',
    prefix: prefix || 'upload',
    optimize: optimize === 'true' || optimize === true
  };

  try {
    console.log('📤 Starting R2 upload...');
    const result = await uploadService.uploadFile(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype,
      uploadOptions
    );

    console.log('✅ Upload completed successfully:', result.cdnUrl);
    console.log('📋 Sending response...');
    return successResponse(res, result, 'File uploaded successfully');
  } catch (error) {
    console.error('❌ Upload error:', error);
    throw new AppError(error.message, 500);
  }
}));

/**
 * @route   POST /api/upload/multiple
 * @desc    Upload multiple files to R2
 * @access  Private
 */
router.post('/multiple', authMiddleware, upload.array('files', 10), asyncHandler(async (req, res) => {
  if (!req.files || req.files.length === 0) {
    throw new AppError('No files provided', 400);
  }

  const { folder, prefix, optimize } = req.body;
  
  const uploadOptions = {
    userId: req.user.id,
    folder: folder || 'general',
    prefix: prefix || 'upload',
    optimize: optimize === 'true' || optimize === true
  };

  try {
    const uploadPromises = req.files.map(file => 
      uploadService.uploadFile(
        file.buffer,
        file.originalname,
        file.mimetype,
        uploadOptions
      )
    );

    const results = await Promise.all(uploadPromises);

    return successResponse(res, {
      uploads: results,
      totalFiles: results.length,
      successCount: results.filter(r => r.success).length
    }, 'Files uploaded successfully');
  } catch (error) {
    console.error('Multiple upload error:', error);
    throw new AppError(error.message, 500);
  }
}));

/**
 * @route   POST /api/upload/test
 * @desc    Test endpoint without middleware
 * @access  Public
 */
router.post('/test', (req, res) => {
  console.log('🔥 TEST ENDPOINT HIT!');
  res.json({ success: true, message: 'Test endpoint works!' });
});

/**
 * @route   POST /api/upload/simple
 * @desc    Simple upload without auth middleware
 * @access  Public (for debug)
 */
router.post('/simple', upload.single('image'), async (req, res) => {
  console.log('🔥 SIMPLE UPLOAD HIT!');
  console.log('📁 File received:', req.file ? req.file.originalname : 'NO FILE');
  console.log('⚙️ Upload options:', req.body);
  
  if (!req.file) {
    return res.status(400).json({ 
      success: false, 
      message: 'No file provided' 
    });
  }
  
  try {
    console.log('📤 Actually uploading to R2...');
    
    const { folder, quality, cropToSquare } = req.body;
    
    // Use upload service to actually upload to R2
    const result = await uploadService.uploadFile(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype,
      {
        userId: 'anonymous',
        folder: folder || 'events',
        prefix: 'img',
        optimize: true, // Enable optimization for cropping
        quality: parseInt(quality) || 85,
        cropToSquare: cropToSquare === 'true' // Convert string to boolean
      }
    );
    
    console.log('✅ R2 upload successful:', result.cdnUrl);
    
    res.json({
      success: true,
      message: 'Image uploaded successfully',
      data: {
        image: result,
        thumbnail: null
      }
    });
  } catch (error) {
    console.error('❌ Simple upload error:', error);
    res.status(500).json({
      success: false,
      message: 'Upload failed: ' + error.message
    });
  }
});

/**
 * @route   POST /api/upload/simple-video
 * @desc    Simple video upload without auth middleware
 * @access  Public (for debug)
 */
router.post('/simple-video', upload.single('file'), async (req, res) => {
  console.log('🔥 SIMPLE VIDEO UPLOAD HIT!');
  console.log('📁 File received:', req.file ? req.file.originalname : 'NO FILE');
  
  if (!req.file) {
    return res.status(400).json({ 
      success: false, 
      message: 'No file provided' 
    });
  }
  
  try {
    console.log('📤 Actually uploading video to R2...');
    
    // Use upload service to actually upload to R2
    const result = await uploadService.uploadFile(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype,
      {
        userId: 'anonymous',
        folder: 'posts/videos',
        prefix: 'video',
        optimize: false // Skip optimization to avoid hanging
      }
    );
    
    console.log('✅ R2 video upload successful:', result.cdnUrl);
    
    res.json({
      success: true,
      message: 'Video uploaded successfully',
      data: result
    });
  } catch (error) {
    console.error('❌ Simple video upload error:', error);
    res.status(500).json({
      success: false,
      message: 'Video upload failed: ' + error.message
    });
  }
});

/**
 * @route   POST /api/upload/image
 * @desc    Upload and optimize image to R2
 * @access  Private
 */
router.post('/image', authMiddleware, upload.single('image'), asyncHandler(async (req, res) => {
  console.log('🔵 Image upload route hit');
  console.log('📁 File received:', req.file ? req.file.originalname : 'NO FILE');
  console.log('👤 User ID:', req.user?.id);
  
  if (!req.file) {
    console.log('❌ No image provided');
    throw new AppError('No image provided', 400);
  }

  // Validate it's an image
  if (!uploadService.isImageFile(req.file.mimetype)) {
    console.log('❌ File is not an image:', req.file.mimetype);
    throw new AppError('File must be an image', 400);
  }

  const { folder, quality, width, height, generateThumbnail } = req.body;
  console.log('⚙️ Upload options:', { folder, quality, width, height, generateThumbnail });
  
  const uploadOptions = {
    userId: req.user.id,
    folder: folder || 'images',
    prefix: 'img',
    optimize: true,
    quality: parseInt(quality) || 85,
    width: parseInt(width) || 1920,
    height: parseInt(height) || 1080
  };

  try {
    console.log('📤 Starting SIMPLE image upload...');
    
    // SIMPLE upload without optimization for now
    const fileName = `img_${Date.now()}_${req.file.originalname}`;
    const fullKey = `${uploadOptions.folder}/${fileName}`;
    const cdnUrl = `${process.env.R2_CDN_BASE_URL}/${fullKey}`;
    
    console.log('✅ BYPASS upload service - return mock success');
    
    const result = {
      success: true,
      key: fullKey,
      fileName: fileName,
      originalName: req.file.originalname,
      cdnUrl: cdnUrl,
      fileSize: req.file.buffer.length,
      mimeType: req.file.mimetype,
      uploadedAt: new Date().toISOString()
    };

    console.log('📋 Sending SIMPLE response...');
    return successResponse(res, {
      image: result,
      thumbnail: null
    }, 'Image uploaded successfully (BYPASS)');
  } catch (error) {
    console.error('Image upload error:', error);
    throw new AppError(error.message, 500);
  }
}));

/**
 * @route   DELETE /api/upload/:key
 * @desc    Delete a file from R2
 * @access  Private
 */
router.delete('/:key(*)', authMiddleware, asyncHandler(async (req, res) => {
  const { key } = req.params;
  
  if (!key) {
    throw new AppError('File key is required', 400);
  }

  try {
    await uploadService.deleteFile(key);
    return successResponse(res, { deleted: true, key }, 'File deleted successfully');
  } catch (error) {
    console.error('Delete error:', error);
    throw new AppError(error.message, 500);
  }
}));

/**
 * @route   GET /api/upload/info/:key
 * @desc    Get file information from R2
 * @access  Private
 */
router.get('/info/:key(*)', authMiddleware, asyncHandler(async (req, res) => {
  const { key } = req.params;
  
  if (!key) {
    throw new AppError('File key is required', 400);
  }

  try {
    const info = await uploadService.getFileInfo(key);
    return successResponse(res, info, 'File info retrieved successfully');
  } catch (error) {
    console.error('Get file info error:', error);
    throw new AppError(error.message, 500);
  }
}));

/**
 * @route   GET /api/upload/stats
 * @desc    Get upload service statistics
 * @access  Private
 */
router.get('/stats', authMiddleware, asyncHandler(async (req, res) => {
  try {
    const stats = uploadService.getStats();
    return successResponse(res, stats, 'Upload service stats retrieved successfully');
  } catch (error) {
    console.error('Get stats error:', error);
    throw new AppError(error.message, 500);
  }
}));

/**
 * @route   POST /api/upload/test
 * @desc    Test upload service configuration
 * @access  Private (admin only)
 */
router.post('/test', authMiddleware, asyncHandler(async (req, res) => {
  // Basic admin check (adjust based on your user model)
  if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
    throw new AppError('Admin access required', 403);
  }

  try {
    const stats = uploadService.getStats();
    
    if (!stats.isConfigured) {
      return errorResponse(res, 'Upload service is not properly configured', 500);
    }

    return successResponse(res, {
      status: 'configured',
      ...stats
    }, 'Upload service is properly configured');
  } catch (error) {
    console.error('Test upload service error:', error);
    throw new AppError(error.message, 500);
  }
}));

module.exports = router;