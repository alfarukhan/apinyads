const { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { Upload } = require('@aws-sdk/lib-storage');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const sharp = require('sharp');

/**
 * 📁 CLOUDFLARE R2 UPLOAD SERVICE
 * 
 * Handles file uploads to Cloudflare R2 storage using S3-compatible API:
 * - Image optimization & compression
 * - File type validation & security
 * - Unique filename generation
 * - CDN URL generation
 * - File deletion & cleanup
 * 
 * ✅ Security: File type validation, size limits
 * ✅ Performance: Image optimization, compression
 * ✅ Scalability: CDN delivery, unique naming
 */
class R2UploadService {
  constructor() {
    // ✅ CENTRALIZED: R2 configuration
    this.config = {
      ACCOUNT_ID: process.env.R2_ACCOUNT_ID,
      S3_ENDPOINT: process.env.R2_S3_ENDPOINT,
      BUCKET_NAME: process.env.R2_BUCKET_NAME,
      CDN_BASE_URL: process.env.R2_CDN_BASE_URL,
      ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID,
      SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY,
      
      // File configuration
      MAX_FILE_SIZE: parseInt(process.env.MAX_FILE_SIZE) || 5 * 1024 * 1024, // 5MB default
      ALLOWED_IMAGE_TYPES: ['jpg', 'jpeg', 'png', 'webp', 'gif'],
      ALLOWED_VIDEO_TYPES: ['mp4', 'mov', 'avi', 'webm'],
      ALLOWED_AUDIO_TYPES: ['mp3', 'wav', 'ogg', 'aac'],
      ALLOWED_DOCUMENT_TYPES: ['pdf', 'doc', 'docx', 'txt'],
      
      // Image optimization
      IMAGE_QUALITY: 85,
      MAX_IMAGE_WIDTH: 1920,
      MAX_IMAGE_HEIGHT: 1080,
      THUMBNAIL_SIZE: 300
    };

    // ✅ Validate critical configuration
    if (!this.config.ACCOUNT_ID || !this.config.ACCESS_KEY_ID || !this.config.SECRET_ACCESS_KEY) {
      console.warn('⚠️  R2 credentials not fully configured. Upload functionality will be limited.');
      this.isConfigured = false;
      return;
    }

    this.isConfigured = true;

    // Initialize S3 client for R2
    this.s3Client = new S3Client({
      region: 'auto',
      endpoint: this.config.S3_ENDPOINT,
      credentials: {
        accessKeyId: this.config.ACCESS_KEY_ID,
        secretAccessKey: this.config.SECRET_ACCESS_KEY,
      },
    });

    console.log('✅ R2UploadService initialized successfully');
  }

  /**
   * Upload a file to R2
   * @param {Buffer} fileBuffer - File buffer
   * @param {string} originalName - Original filename
   * @param {string} mimeType - File MIME type
   * @param {Object} options - Upload options
   * @returns {Promise<Object>} Upload result with CDN URL
   */
  async uploadFile(fileBuffer, originalName, mimeType, options = {}) {
    try {
      if (!this.isConfigured) {
        throw new Error('R2 upload service is not properly configured');
      }

      // Validate file
      this.validateFile(fileBuffer, originalName, mimeType);

      // Generate unique filename
      const fileExtension = path.extname(originalName).toLowerCase();
      const fileName = this.generateFileName(originalName, options.prefix);
      const fullKey = options.folder ? `${options.folder}/${fileName}` : fileName;

      let processedBuffer = fileBuffer;

      // Optimize image if needed
      if (this.isImageFile(mimeType)) {
        processedBuffer = await this.optimizeImage(fileBuffer, options);
      }

      // Upload to R2
      const uploadParams = {
        Bucket: this.config.BUCKET_NAME,
        Key: fullKey,
        Body: processedBuffer,
        ContentType: mimeType,
        CacheControl: 'public, max-age=31536000', // 1 year cache
        Metadata: {
          originalName: originalName,
          uploadedAt: new Date().toISOString(),
          userId: options.userId || 'anonymous'
        }
      };

      console.log(`📤 Starting upload to R2: ${fullKey}`);
      
      // Direct S3 PutObject instead of Upload for better control
      const putCommand = new PutObjectCommand(uploadParams);
      const result = await this.s3Client.send(putCommand);
      
      console.log(`🎯 PutObject completed for: ${fullKey}`, result.$metadata?.httpStatusCode);

      // Generate CDN URL
      const cdnUrl = `${this.config.CDN_BASE_URL}/${fullKey}`;

      console.log(`✅ File uploaded successfully: ${fullKey}`);

      return {
        success: true,
        key: fullKey,
        fileName: fileName,
        originalName: originalName,
        cdnUrl: cdnUrl,
        s3Url: `${this.config.S3_ENDPOINT}/${this.config.BUCKET_NAME}/${fullKey}`,
        fileSize: processedBuffer.length,
        mimeType: mimeType,
        uploadedAt: new Date().toISOString(),
        httpStatusCode: result.$metadata?.httpStatusCode || 200
      };

    } catch (error) {
      console.error('❌ Upload failed:', error);
      throw new Error(`Upload failed: ${error.message}`);
    }
  }

  /**
   * Delete a file from R2
   * @param {string} key - File key in R2
   * @returns {Promise<boolean>} Success status
   */
  async deleteFile(key) {
    try {
      if (!this.isConfigured) {
        throw new Error('R2 upload service is not properly configured');
      }

      const deleteParams = {
        Bucket: this.config.BUCKET_NAME,
        Key: key,
      };

      await this.s3Client.send(new DeleteObjectCommand(deleteParams));
      
      console.log(`✅ File deleted successfully: ${key}`);
      return true;

    } catch (error) {
      console.error('❌ Delete failed:', error);
      throw new Error(`Delete failed: ${error.message}`);
    }
  }

  /**
   * Get file info from R2
   * @param {string} key - File key in R2
   * @returns {Promise<Object>} File information
   */
  async getFileInfo(key) {
    try {
      if (!this.isConfigured) {
        throw new Error('R2 upload service is not properly configured');
      }

      const headParams = {
        Bucket: this.config.BUCKET_NAME,
        Key: key,
      };

      const result = await this.s3Client.send(new GetObjectCommand(headParams));
      
      return {
        key: key,
        contentType: result.ContentType,
        contentLength: result.ContentLength,
        lastModified: result.LastModified,
        metadata: result.Metadata,
        cdnUrl: `${this.config.CDN_BASE_URL}/${key}`
      };

    } catch (error) {
      console.error('❌ Get file info failed:', error);
      throw new Error(`Get file info failed: ${error.message}`);
    }
  }

  /**
   * Optimize image for web delivery
   * @param {Buffer} imageBuffer - Image buffer
   * @param {Object} options - Optimization options
   * @returns {Promise<Buffer>} Optimized image buffer
   */
  async optimizeImage(imageBuffer, options = {}) {
    try {
      const {
        width = this.config.MAX_IMAGE_WIDTH,
        height = this.config.MAX_IMAGE_HEIGHT,
        quality = this.config.IMAGE_QUALITY,
        format = 'jpeg',
        cropToSquare = false
      } = options;

      const sharpInstance = sharp(imageBuffer);
      
      // Get original metadata
      const metadata = await sharpInstance.metadata();
      console.log(`📐 Original image: ${metadata.width}x${metadata.height}`);
      
      // Crop to square if requested
      if (cropToSquare) {
        const minDimension = Math.min(metadata.width, metadata.height);
        const left = Math.floor((metadata.width - minDimension) / 2);
        const top = Math.floor((metadata.height - minDimension) / 2);
        
        console.log(`✂️ Cropping to square: ${minDimension}x${minDimension} from (${left}, ${top})`);
        
        sharpInstance.extract({
          left,
          top,
          width: minDimension,
          height: minDimension
        });
        
        // Resize the square to optimal size (800x800 for events)
        sharpInstance.resize(800, 800, {
          fit: 'cover',
          position: 'center'
        });
      } else {
        // Resize if needed (original logic)
        if (metadata.width > width || metadata.height > height) {
          sharpInstance.resize(width, height, {
            fit: 'inside',
            withoutEnlargement: true
          });
        }
      }

      // Convert and optimize
      let optimized;
      switch (format.toLowerCase()) {
        case 'png':
          optimized = await sharpInstance
            .png({ quality, compressionLevel: 9 })
            .toBuffer();
          break;
        case 'webp':
          optimized = await sharpInstance
            .webp({ quality })
            .toBuffer();
          break;
        default:
          optimized = await sharpInstance
            .jpeg({ quality, progressive: true })
            .toBuffer();
      }

      console.log(`✅ Image optimized: ${imageBuffer.length} → ${optimized.length} bytes`);
      return optimized;

    } catch (error) {
      console.error('❌ Image optimization failed:', error);
      // Return original buffer if optimization fails
      return imageBuffer;
    }
  }

  /**
   * Generate thumbnail for image
   * @param {Buffer} imageBuffer - Image buffer
   * @param {number} size - Thumbnail size
   * @returns {Promise<Buffer>} Thumbnail buffer
   */
  async generateThumbnail(imageBuffer, size = this.config.THUMBNAIL_SIZE) {
    try {
      const thumbnail = await sharp(imageBuffer)
        .resize(size, size, {
          fit: 'cover',
          position: 'center'
        })
        .jpeg({ quality: 80 })
        .toBuffer();

      return thumbnail;
    } catch (error) {
      console.error('❌ Thumbnail generation failed:', error);
      throw new Error(`Thumbnail generation failed: ${error.message}`);
    }
  }

  /**
   * Validate file before upload
   * @param {Buffer} fileBuffer - File buffer
   * @param {string} originalName - Original filename
   * @param {string} mimeType - File MIME type
   */
  validateFile(fileBuffer, originalName, mimeType) {
    // Check file size
    if (fileBuffer.length > this.config.MAX_FILE_SIZE) {
      throw new Error(`File too large. Maximum size: ${this.config.MAX_FILE_SIZE} bytes`);
    }

    // Check file extension
    const fileExtension = path.extname(originalName).toLowerCase().substring(1);
    const allowedTypes = [
      ...this.config.ALLOWED_IMAGE_TYPES,
      ...this.config.ALLOWED_VIDEO_TYPES,
      ...this.config.ALLOWED_AUDIO_TYPES,
      ...this.config.ALLOWED_DOCUMENT_TYPES
    ];

    if (!allowedTypes.includes(fileExtension)) {
      throw new Error(`File type not allowed: ${fileExtension}`);
    }

    // Basic security check - ensure file is not executable
    const dangerousExtensions = ['exe', 'bat', 'cmd', 'com', 'scr', 'js', 'vbs', 'jar'];
    if (dangerousExtensions.includes(fileExtension)) {
      throw new Error('Executable files are not allowed');
    }
  }

  /**
   * Generate unique filename
   * @param {string} originalName - Original filename
   * @param {string} prefix - Optional prefix
   * @returns {string} Unique filename
   */
  generateFileName(originalName, prefix = '') {
    const fileExtension = path.extname(originalName).toLowerCase();
    const timestamp = Date.now();
    const uuid = uuidv4().substring(0, 8);
    
    const basePrefix = prefix ? `${prefix}_` : '';
    return `${basePrefix}${timestamp}_${uuid}${fileExtension}`;
  }

  /**
   * Check if file is an image
   * @param {string} mimeType - File MIME type
   * @returns {boolean} Is image file
   */
  isImageFile(mimeType) {
    return mimeType && mimeType.startsWith('image/');
  }

  /**
   * Check if file is a video
   * @param {string} mimeType - File MIME type
   * @returns {boolean} Is video file
   */
  isVideoFile(mimeType) {
    return mimeType && mimeType.startsWith('video/');
  }

  /**
   * Check if file is audio
   * @param {string} mimeType - File MIME type
   * @returns {boolean} Is audio file
   */
  isAudioFile(mimeType) {
    return mimeType && mimeType.startsWith('audio/');
  }

  /**
   * Get upload statistics
   * @returns {Object} Upload service statistics
   */
  getStats() {
    return {
      isConfigured: this.isConfigured,
      bucketName: this.config.BUCKET_NAME,
      cdnBaseUrl: this.config.CDN_BASE_URL,
      maxFileSize: this.config.MAX_FILE_SIZE,
      allowedTypes: {
        images: this.config.ALLOWED_IMAGE_TYPES,
        videos: this.config.ALLOWED_VIDEO_TYPES,
        audio: this.config.ALLOWED_AUDIO_TYPES,
        documents: this.config.ALLOWED_DOCUMENT_TYPES
      }
    };
  }
}

module.exports = R2UploadService;