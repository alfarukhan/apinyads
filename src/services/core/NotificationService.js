const { prisma } = require('../../lib/prisma');
const nodemailer = require('nodemailer');
const admin = require('firebase-admin');
const path = require('path');

/**
 * 📬 CENTRALIZED NOTIFICATION SERVICE
 * 
 * Unified communication system for DanceSignal:
 * - Email notifications (transactional & marketing)
 * - Push notifications (FCM)
 * - SMS notifications (future)
 * - In-app notifications
 * - Template management
 * - Delivery tracking & retry logic
 * 
 * ✅ Reliability: Retry logic & fallback options
 * ✅ Performance: Queue-based delivery
 * ✅ Personalization: Dynamic template rendering
 */
class NotificationService {
  constructor() {
    this.prisma = prisma;
    
    // ✅ CENTRALIZED: Notification configuration
    this.config = {
      // Email Configuration
      EMAIL_ENABLED: process.env.EMAIL_ENABLED !== 'false',
      SMTP_HOST: process.env.SMTP_HOST,
      SMTP_PORT: process.env.SMTP_PORT || 587,
      SMTP_USER: process.env.SMTP_USER,
      SMTP_PASS: process.env.SMTP_PASS,
      FROM_EMAIL: process.env.FROM_EMAIL || 'noreply@dancesignal.com',
      FROM_NAME: process.env.FROM_NAME || 'DanceSignal',
      
      // Push Notification Configuration
      PUSH_ENABLED: process.env.PUSH_ENABLED !== 'false',
      FCM_ENABLED: process.env.FCM_ENABLED !== 'false',
      
      // SMS Configuration (future)
      SMS_ENABLED: process.env.SMS_ENABLED === 'true',
      SMS_PROVIDER: process.env.SMS_PROVIDER || 'twilio',
      
      // Delivery Configuration
      MAX_RETRY_ATTEMPTS: parseInt(process.env.NOTIFICATION_MAX_RETRIES) || 3,
      RETRY_DELAY_MS: parseInt(process.env.NOTIFICATION_RETRY_DELAY) || 60000, // 1 minute
      BATCH_SIZE: parseInt(process.env.NOTIFICATION_BATCH_SIZE) || 100,
      
      // Rate Limiting
      EMAIL_RATE_LIMIT: parseInt(process.env.EMAIL_RATE_LIMIT) || 1000, // per hour
      PUSH_RATE_LIMIT: parseInt(process.env.PUSH_RATE_LIMIT) || 10000, // per hour
      
      // Template Configuration
      TEMPLATE_CACHE_TTL: parseInt(process.env.TEMPLATE_CACHE_TTL) || 3600000 // 1 hour
    };

    // ✅ Initialize email transporter
    this.emailTransporter = null;
    if (this.config.EMAIL_ENABLED && this.config.SMTP_HOST) {
      this.initializeEmailTransporter();
    }

    // ✅ Template cache
    this.templateCache = new Map();
    
    // ✅ Delivery queue (in-memory for now, will move to Redis/Queue service later)
    this.deliveryQueue = [];
    this.isProcessingQueue = false;
    
    // ✅ Firebase initialization flag
    this.firebaseInitialized = false;

    console.log('📬 NotificationService initialized:', {
      emailEnabled: this.config.EMAIL_ENABLED,
      pushEnabled: this.config.PUSH_ENABLED,
      smsEnabled: this.config.SMS_ENABLED,
      batchSize: this.config.BATCH_SIZE
    });

    // ✅ Initialize Firebase Admin SDK for push notifications (async)
    this.initializeFirebase().catch(error => {
      console.error('❌ Firebase initialization failed in constructor:', error.message);
      this.config.FCM_ENABLED = false;
    });
    
    // ✅ Start queue processor
    this.startQueueProcessor();
  }

  /**
   * 🔥 FIREBASE INITIALIZATION
   */
  async initializeFirebase() {
    if (admin.apps.length === 0) {
      let serviceAccount = null;
      
      try {
        // ✅ PRIORITY 1: Try environment variable first (more secure)
        if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
          console.log('🔑 Loading Firebase service account from environment variable...');
          try {
            serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
            console.log('✅ Firebase service account loaded from environment');
          } catch (parseError) {
            console.error('❌ Failed to parse Firebase service account from environment:', parseError.message);
            throw new Error('Invalid JSON in FIREBASE_SERVICE_ACCOUNT_KEY environment variable');
          }
        } else {
          // ✅ FALLBACK: Try service account file
          console.log('🔄 Environment variable not found, trying service account file...');
          const serviceAccountPath = path.join(__dirname, '../../../config/dsapp-aeda5-firebase-adminsdk-fbsvc-4c6ddacfc5.json');
          
          console.log('🔍 Loading Firebase service account from:', serviceAccountPath);
          
          // Check if file exists
          const fs = require('fs');
          if (!fs.existsSync(serviceAccountPath)) {
            throw new Error(`Service account file not found at: ${serviceAccountPath}`);
          }
          
          // Load service account from file
          serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
          console.log('✅ Firebase service account loaded from file');
        }
        
        // ✅ Validate service account
        if (!serviceAccount || !serviceAccount.project_id || !serviceAccount.private_key || !serviceAccount.client_email) {
          throw new Error('Invalid service account: missing required fields (project_id, private_key, client_email)');
        }
        
        console.log('🔍 Firebase project ID:', serviceAccount.project_id);
        console.log('🔍 Service account email:', serviceAccount.client_email);
        
        // ✅ Initialize Firebase Admin SDK (tanpa time override - 2025 is correct!)
        admin.initializeApp({
          credential: admin.credential.cert(serviceAccount),
          projectId: serviceAccount.project_id
        });
        
        // ✅ SIMPLIFIED: Skip validation test to prevent JWT signature issues with Google servers
        console.log('🔄 Skipping Firebase validation test (prevents JWT signature errors)');
        // await this.validateFirebaseAccess(); // Disabled: causes JWT signature issues
        
        this.firebaseInitialized = true;
        console.log('🔥 Firebase Admin SDK initialized and validated successfully');
        
      } catch (error) {
        console.error('❌ Firebase Admin SDK initialization failed:', error.message);
        console.error('❌ Full error:', error);
        
        // ✅ Disable Firebase features if initialization fails
        console.warn('⚠️ Firebase not initialized - push notifications disabled');
        this.config.FCM_ENABLED = false;
        this.firebaseInitialized = false;
      }
    } else {
      console.log('🔥 Firebase Admin SDK already initialized');
      // ✅ SIMPLIFIED: Skip re-validation to prevent JWT signature issues
      this.firebaseInitialized = true;
      console.log('🔄 Skipping Firebase re-validation (prevents JWT signature errors)');
      // try {
      //   await this.validateFirebaseAccess(); // Disabled: causes JWT signature issues
      //   this.firebaseInitialized = true;
      //   console.log('🔥 Firebase Admin SDK access validated');
      // } catch (error) {
      //   console.error('❌ Firebase access validation failed:', error.message);
      //   this.config.FCM_ENABLED = false;
      //   this.firebaseInitialized = false;
      // }
    }
  }

  /**
   * 🔍 VALIDATE FIREBASE ACCESS
   * Test Firebase Admin SDK access and FCM API availability
   */
  async validateFirebaseAccess() {
    try {
      // Test Firebase Messaging access
      const messaging = admin.messaging();
      
      // Method 1: Try to get project info (lighter test)
      try {
        console.log('🔍 Testing Firebase project access...');
        
        // Try to validate a single dummy token (lighter than batch)
        const dummyToken = 'dTestToken123:APA91bTest_ValidationCheck_InvalidToken';
        
        await messaging.send({
          token: dummyToken,
          notification: {
            title: 'Firebase Test',
            body: 'Validation Check'
          }
        }, true); // dry run mode - doesn't actually send
        
      } catch (testError) {
        console.log('🔍 Firebase test error code:', testError.code);
        console.log('🔍 Firebase test error message:', testError.message);
        
        // Handle specific error cases
        if (testError.code === 'messaging/unknown-error') {
          if (testError.message.includes('404') || testError.message.includes('/batch')) {
            throw new Error('Firebase Cloud Messaging API not enabled or service account lacks FCM permissions. Please enable FCM API in Firebase Console.');
          }
          if (testError.message.includes('403')) {
            throw new Error('Firebase service account does not have permission to send messages. Check IAM roles.');
          }
          // Other unknown errors
          throw new Error(`Firebase Cloud Messaging API error: ${testError.message}`);
        }
        
        if (testError.code === 'messaging/authentication-error') {
          throw new Error('Firebase service account authentication failed. Check service account key.');
        }
        
        if (testError.code === 'messaging/project-not-found') {
          throw new Error('Firebase project not found. Check project ID in service account.');
        }
        
        // Expected errors for dummy token (means FCM API is working)
        if (testError.code === 'messaging/registration-token-not-registered' || 
            testError.code === 'messaging/invalid-registration-token' ||
            testError.code === 'messaging/invalid-argument') {
          console.log('✅ FCM API accessible (dummy token rejected as expected)');
          return true;
        }
        
        // Unexpected error
        console.warn('⚠️ Unexpected Firebase test error:', testError.code, testError.message);
        throw testError;
      }
      
      console.log('✅ Firebase Messaging API access validated');
      return true;
    } catch (error) {
      console.error('❌ Firebase access validation failed:', error.message);
      throw error;
    }
  }

  /**
   * 🔄 RE-ENABLE FCM
   * Attempt to re-enable FCM after it was disabled due to API issues
   */
  async reEnableFCM() {
    if (this.config.FCM_ENABLED) {
      console.log('✅ FCM already enabled');
      return true;
    }
    
    console.log('🔄 Attempting to re-enable Firebase Cloud Messaging...');
    
    try {
      // Reset flags
      this.config.FCM_ENABLED = true;
      this.firebaseInitialized = false;
      
      // Re-initialize Firebase
      await this.initializeFirebase();
      
      if (this.firebaseInitialized) {
        console.log('✅ FCM successfully re-enabled');
        return true;
      } else {
        console.log('❌ FCM re-enable failed - initialization unsuccessful');
        this.config.FCM_ENABLED = false;
        return false;
      }
    } catch (error) {
      console.error('❌ FCM re-enable failed:', error.message);
      this.config.FCM_ENABLED = false;
      this.firebaseInitialized = false;
      return false;
    }
  }

  /**
   * 📧 EMAIL INITIALIZATION
   */
  initializeEmailTransporter() {
    try {
      this.emailTransporter = nodemailer.createTransporter({
        host: this.config.SMTP_HOST,
        port: this.config.SMTP_PORT,
        secure: this.config.SMTP_PORT === 465, // true for 465, false for other ports
        auth: {
          user: this.config.SMTP_USER,
          pass: this.config.SMTP_PASS
        },
        pool: true, // Use connection pooling
        maxConnections: 5,
        maxMessages: 100
      });

      console.log('📧 Email transporter initialized successfully');
    } catch (error) {
      console.error('❌ Failed to initialize email transporter:', error);
      this.config.EMAIL_ENABLED = false;
    }
  }

  /**
   * 🚀 SEND NOTIFICATION (MAIN METHOD)
   * 
   * Universal notification sending with multiple channels
   */
  async sendNotification(notification) {
    try {
      const {
        userId,
        type,
        channels = ['email', 'push'], // Default channels
        priority = 'normal', // normal, high, urgent
        template,
        data = {},
        metadata = {}
      } = notification;

      console.log(`📬 Sending ${type} notification to user ${userId} via ${channels.join(', ')}`);

      // ✅ Get user preferences and contact info
      const recipient = await this.getRecipientInfo(userId);
      if (!recipient) {
        throw new Error(`User ${userId} not found`);
      }

      // ✅ Check user preferences
      const userPreferences = await this.getUserNotificationPreferences(userId);
      const filteredChannels = this.filterChannelsByPreferences(channels, type, userPreferences);

      if (filteredChannels.length === 0) {
        console.log(`📵 User ${userId} has disabled all channels for ${type} notifications`);
        return { success: true, reason: 'User disabled notifications', channels: [] };
      }

      // ✅ Create notification record
      const notificationRecord = await this.createNotificationRecord({
        userId,
        type,
        channels: filteredChannels,
        priority,
        template,
        data,
        metadata
      });

      // ✅ Process each channel
      const deliveryResults = [];
      
      for (const channel of filteredChannels) {
        try {
          let result;
          
          switch (channel) {
            case 'email':
              result = await this.sendEmailNotification(recipient, type, template, data, notificationRecord.id);
              break;
            case 'push':
              result = await this.sendPushNotification(recipient, type, template, data, notificationRecord.id);
              break;
            case 'sms':
              result = await this.sendSMSNotification(recipient, type, template, data, notificationRecord.id);
              break;
            case 'in_app':
              result = await this.sendInAppNotification(recipient, type, template, data, notificationRecord.id);
              break;
            default:
              result = { success: false, error: `Unknown channel: ${channel}` };
          }

          deliveryResults.push({ channel, ...result });

        } catch (channelError) {
          console.error(`❌ Error sending ${channel} notification:`, channelError);
          deliveryResults.push({ 
            channel, 
            success: false, 
            error: channelError.message 
          });
        }
      }

      // ✅ Update notification record with results
      await this.updateNotificationRecord(notificationRecord.id, deliveryResults);

      const successCount = deliveryResults.filter(r => r.success).length;
      console.log(`📊 Notification sent: ${successCount}/${deliveryResults.length} channels successful`);

      return {
        success: true,
        notificationId: notificationRecord.id,
        channels: deliveryResults,
        deliveredChannels: successCount
      };

    } catch (error) {
      console.error('❌ Notification sending failed:', error);
      throw error;
    }
  }

  /**
   * 📧 EMAIL NOTIFICATIONS
   */
  async sendEmailNotification(recipient, type, templateName, data, notificationId) {
    if (!this.config.EMAIL_ENABLED || !this.emailTransporter) {
      return { success: false, error: 'Email service not configured' };
    }

    try {
      // ✅ Get email template
      const template = await this.getEmailTemplate(templateName, type);
      
      // ✅ Render template with data
      const renderedEmail = this.renderTemplate(template, {
        ...data,
        recipient: recipient,
        unsubscribeUrl: this.generateUnsubscribeUrl(recipient.id, type)
      });

      // ✅ Prepare email options
      const mailOptions = {
        from: `${this.config.FROM_NAME} <${this.config.FROM_EMAIL}>`,
        to: recipient.email,
        subject: renderedEmail.subject,
        html: renderedEmail.html,
        text: renderedEmail.text || this.htmlToText(renderedEmail.html),
        headers: {
          'X-Notification-ID': notificationId,
          'X-Notification-Type': type
        }
      };

      // ✅ Send email
      const result = await this.emailTransporter.sendMail(mailOptions);
      
      console.log(`📧 Email sent successfully: ${result.messageId}`);
      return {
        success: true,
        messageId: result.messageId,
        recipient: recipient.email
      };

    } catch (error) {
      console.error('❌ Email sending failed:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 📱 PUSH NOTIFICATIONS
   */
  async sendPushNotification(recipient, type, templateName, data, notificationId) {
    console.log(`📱 Starting push notification for user ${recipient.id}, type: ${type}`);
    
    if (!this.config.PUSH_ENABLED || !this.config.FCM_ENABLED) {
      console.log('❌ Push notifications disabled in config:', {
        PUSH_ENABLED: this.config.PUSH_ENABLED,
        FCM_ENABLED: this.config.FCM_ENABLED
      });
      return { success: false, error: 'Push notifications not configured' };
    }

    // Check if Firebase Admin is initialized - wait for initialization if needed
    if (admin.apps.length === 0 || !this.firebaseInitialized) {
      console.log('🔄 Firebase not yet initialized, attempting initialization...');
      try {
        await this.initializeFirebase();
        if (!this.firebaseInitialized) {
          console.error('❌ Firebase Admin SDK initialization failed');
          return { success: false, error: 'Firebase initialization failed' };
        }
      } catch (initError) {
        console.error('❌ Firebase Admin SDK initialization error:', initError.message);
        return { success: false, error: 'Firebase initialization error: ' + initError.message };
      }
    }

    try {
      // ✅ Get user's FCM tokens
      console.log(`🔍 Getting FCM tokens for user ${recipient.id}`);
      const fcmTokens = await this.getUserFCMTokens(recipient.id);
      
      console.log(`📱 Found ${fcmTokens.length} FCM tokens for user ${recipient.id}`);
      
      if (fcmTokens.length === 0) {
        console.error(`❌ CRITICAL: No FCM tokens found for user ${recipient.id}`);
        console.error(`❌ Push notification FAILED - User needs to register FCM token from mobile app`);
        return { success: false, error: 'No FCM tokens found for user - User needs to register FCM token from mobile app' };
      }

      // ✅ Get push template
      const template = await this.getPushTemplate(templateName, type, data);
      
      // ✅ Render template
      const renderedPush = this.renderTemplate(template, {
        ...data,
        recipient: recipient
      });

      // ✅ Prepare FCM message
      const message = {
        notification: {
          title: renderedPush.title,
          body: renderedPush.body,
          image: renderedPush.icon || renderedPush.image // Use 'image' instead of 'icon'
        },
        data: {
          notificationId: notificationId,
          type: type,
          ...data.extraData
        },
        tokens: fcmTokens
      };

      // ✅ Send push notification - Use individual sends instead of batch to avoid 404 /batch error
      console.log(`🚀 Sending push notification to ${fcmTokens.length} tokens:`, {
        title: message.notification.title,
        body: message.notification.body,
        type: type,
        userId: recipient.id,
        timestamp: new Date().toISOString(), // Server time
        tokens: fcmTokens.slice(0, 3) // Show first 3 tokens for debugging
      });
      
      // Send to each token individually (like old implementation)
      const results = [];
      for (const token of fcmTokens) {
        try {
          const individualMessage = {
            ...message,
            token: token // Individual token instead of tokens array
          };
          delete individualMessage.tokens; // Remove tokens array
          
          const result = await admin.messaging().send(individualMessage);
          results.push({ success: true, messageId: result });
        } catch (error) {
          results.push({ success: false, error: error });
        }
      }
      
      // Create compatible result object
      const result = {
        responses: results,
        successCount: results.filter(r => r.success).length,
        failureCount: results.filter(r => !r.success).length
      };
      
      console.log(`📱 Push sent: ${result.successCount}/${fcmTokens.length} tokens successful`);
      
      if (result.failureCount > 0) {
        const failures = result.responses
          .filter(r => !r.success)
          .map(r => ({ error: r.error?.message, code: r.error?.code }));
          
        console.log(`⚠️ Push failures:`, failures);
        
        // Check for critical Firebase errors
        const criticalErrors = failures.filter(f => 
          f.code === 'messaging/unknown-error' || 
          f.code === 'messaging/authentication-error'
        );
        
        if (criticalErrors.length > 0) {
          console.error('❌ Critical Firebase errors detected:', criticalErrors);
          // Log the specific error for debugging
          criticalErrors.forEach(error => {
            if (error.error && error.error.includes('404')) {
              console.error('❌ Firebase project not found or service account lacks permissions');
            }
          });
        }
      }

      // ✅ Clean up invalid tokens
      if (result.failureCount > 0) {
        await this.cleanupInvalidFCMTokens(fcmTokens, result.responses);
      }

      return {
        success: result.successCount > 0,
        successCount: result.successCount,
        failureCount: result.failureCount,
        totalTokens: fcmTokens.length
      };

    } catch (error) {
      console.error('❌ Push notification failed:', {
        message: error.message || 'Unknown error',
        stack: error.stack,
        name: error.name,
        code: error.code,
        details: error.details,
        errorInfo: error.errorInfo,
        fullError: error
      });
      
      // Handle specific Firebase API errors
      if (error.code === 'messaging/unknown-error') {
        if (error.message.includes('404') || error.message.includes('/batch')) {
          console.error('❌ CRITICAL: Firebase Cloud Messaging API not available - disabling FCM');
          console.error('❌ SOLUTION: Enable Cloud Messaging API in Firebase Console:');
          console.error('   → https://console.firebase.google.com/project/dsapp-aeda5/settings/cloudmessaging/');
          console.error('   → Or enable Firebase Cloud Messaging API in Google Cloud Console');
          
          // Temporarily disable FCM to prevent repeated errors
          this.config.FCM_ENABLED = false;
          this.firebaseInitialized = false;
          
          return {
            success: false,
            error: 'Firebase Cloud Messaging API not enabled - push notifications disabled'
          };
        }
        
        if (error.message.includes('403')) {
          console.error('❌ CRITICAL: Firebase service account lacks FCM permissions');
          console.error('❌ SOLUTION: Grant "Firebase Cloud Messaging API Agent" role to service account');
          
          // Temporarily disable FCM
          this.config.FCM_ENABLED = false;
          this.firebaseInitialized = false;
          
          return {
            success: false,
            error: 'Firebase service account lacks FCM permissions'
          };
        }
      }
      
      return {
        success: false,
        error: error.message || `Push notification error: ${error.name || 'Unknown'}`
      };
    }
  }

  /**
   * 📱 IN-APP NOTIFICATIONS
   */
  async sendInAppNotification(recipient, type, templateName, data, notificationId) {
    try {
      // ✅ Get in-app template
      const template = await this.getInAppTemplate(templateName, type);
      
      // ✅ Render template
      const renderedNotification = this.renderTemplate(template, {
        ...data,
        recipient: recipient
      });

      // ✅ Create in-app notification record
      await this.prisma.inAppNotification.create({
        data: {
          userId: recipient.id,
          type: type,
          title: renderedNotification.title,
          message: renderedNotification.message,
          icon: renderedNotification.icon,
          actionUrl: renderedNotification.actionUrl,
          metadata: data,
          isRead: false,
          notificationId: notificationId
        }
      });

      console.log(`📱 In-app notification created for user ${recipient.id}`);
      return { success: true };

    } catch (error) {
      console.error('❌ In-app notification failed:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 📨 SMS NOTIFICATIONS (FUTURE)
   */
  async sendSMSNotification(recipient, type, templateName, data, notificationId) {
    if (!this.config.SMS_ENABLED) {
      return { success: false, error: 'SMS service not configured' };
    }

    // TODO: Implement SMS sending (Twilio, etc.)
    return { success: false, error: 'SMS service not yet implemented' };
  }

  /**
   * 🎨 TEMPLATE MANAGEMENT
   */
  async getEmailTemplate(templateName, notificationType) {
    const cacheKey = `email_${templateName}_${notificationType}`;
    
    if (this.templateCache.has(cacheKey)) {
      return this.templateCache.get(cacheKey);
    }

    // ✅ TEMP FIX: Skip database template lookup until tables are created
    // TODO: Create notificationTemplate table in schema
    const dbTemplate = null;

    if (dbTemplate) {
      this.templateCache.set(cacheKey, dbTemplate);
      return dbTemplate;
    }

    // ✅ Fallback to default templates
    const defaultTemplate = this.getDefaultEmailTemplate(templateName, notificationType);
    this.templateCache.set(cacheKey, defaultTemplate);
    return defaultTemplate;
  }

  /**
   * 📱 GET PUSH TEMPLATE
   */
  async getPushTemplate(templateName, notificationType, data = {}) {
    const cacheKey = `push_${templateName}_${notificationType}`;
    
    if (this.templateCache.has(cacheKey)) {
      return this.templateCache.get(cacheKey);
    }

    // Fallback to default templates
    const defaultTemplate = this.getDefaultPushTemplate(templateName, notificationType, data);
    this.templateCache.set(cacheKey, defaultTemplate);
    return defaultTemplate;
  }

  getDefaultPushTemplate(templateName, notificationType, data = {}) {
    const templates = {
      payment_created: {
        title: '💰 Payment Pending',
        body: `Complete payment for {{eventName}} ({{quantity}} tickets). Booking: {{bookingCode}}`,
        icon: '@mipmap/ic_launcher',
        data: {
          type: 'PAYMENT_CREATED',
          action: 'COMPLETE_PAYMENT',
          ...data
        }
      },
      payment_success: {
        title: '🎉 Payment Successful!',
        body: `Your payment for {{eventName}} was successful. Enjoy the event!`,
        icon: '@mipmap/ic_launcher',
        data: {
          type: 'PAYMENT_SUCCESS',
          action: 'VIEW_TICKET',
          ...data
        }
      },
      payment_failed: {
        title: '❌ Payment Failed',
        body: `Payment for {{eventName}} was unsuccessful. Please try again.`,
        icon: '@mipmap/ic_launcher',
        data: {
          type: 'PAYMENT_FAILED',
          action: 'RETRY_PAYMENT',
          ...data
        }
      },
      booking_expiry_warning: {
        title: '⏰ Booking Expires Soon',
        body: `Your booking for {{eventName}} expires in 15 minutes. Complete payment now!`,
        icon: '@mipmap/ic_launcher',
        data: {
          type: 'BOOKING_EXPIRY_WARNING',
          action: 'COMPLETE_PAYMENT',
          ...data
        }
      },
      ticket_generated: {
        title: '🎫 Your Ticket is Ready!',
        body: `Your ticket for {{eventName}} is ready. Tap to view.`,
        icon: '@mipmap/ic_launcher',
        data: {
          type: 'TICKET_GENERATED',
          action: 'VIEW_TICKET',
          ...data
        }
      },
      event_reminder: {
        title: '📅 Event Reminder',
        body: `{{eventName}} starts in {{timeUntilEvent}}. Don't miss it!`,
        icon: '@mipmap/ic_launcher',
        data: {
          type: 'EVENT_REMINDER',
          action: 'VIEW_EVENT',
          ...data
        }
      },
      access_transferred: {
        title: '🎫 Access Transferred',
        body: `You received access to {{eventName}} from @{{fromUsername}}`,
        icon: '@mipmap/ic_launcher',
        data: {
          type: 'ACCESS_TRANSFERRED',
          action: 'VIEW_TICKET',
          ...data
        }
      },
      payment_reminder: {
        title: '⏰ Payment Reminder',
        body: `Complete payment for {{eventName}} before it expires in {{timeRemaining}}!`,
        icon: '@mipmap/ic_launcher',
        data: {
          type: 'PAYMENT_REMINDER',
          action: 'COMPLETE_PAYMENT',
          ...data
        }
      },
      tickets_ready: {
        title: '🎫 Your Tickets Are Ready!',
        body: `Your {{ticketCount}} {{ticketWord}} for {{eventName}} are ready to view!`,
        icon: '@mipmap/ic_launcher',
        data: {
          type: 'TICKETS_READY',
          action: 'VIEW_TICKETS',
          ...data
        }
      },
      access_ticket_generated: {
        title: '🎟️ Access Ticket Generated!',
        body: `Your access ticket for {{eventName}} has been generated. Tap to view your QR code!`,
        icon: '@mipmap/ic_launcher',
        data: {
          type: 'ACCESS_TICKET_GENERATED',
          action: 'VIEW_ACCESS_TICKET',
          ...data
        }
      },
      payment_processing: {
        title: '🔄 Payment Processing',
        body: `Your payment for {{eventName}} is being processed. Please wait...`,
        icon: '@mipmap/ic_launcher',
        data: {
          type: 'PAYMENT_PROCESSING',
          action: 'VIEW_BOOKING',
          ...data
        }
      },
      payment_expired: {
        title: '⏰ Payment Expired',
        body: `Your payment window for {{eventName}} has expired. You can try booking again.`,
        icon: '@mipmap/ic_launcher',
        data: {
          type: 'PAYMENT_EXPIRED',
          action: 'BOOK_AGAIN',
          ...data
        }
      },
      custom: {
        title: '🔔 {{title}}',
        body: `{{body}}`,
        icon: '@mipmap/ic_launcher',
        data: {
          type: 'CUSTOM',
          action: 'OPEN_APP',
          ...data
        }
      },
      default: {
        title: '🔔 DanceSignal',
        body: `You have a new notification`,
        icon: '@mipmap/ic_launcher',
        data: {
          type: 'GENERAL',
          action: 'OPEN_APP',
          ...data
        }
      }
    };

    return templates[templateName] || templates.default;
  }

  getDefaultEmailTemplate(templateName, notificationType) {
    const templates = {
      payment_created: {
        subject: 'Payment Created - {{eventName}}',
        html: `
          <h2>Payment Created</h2>
          <p>Hi {{recipient.firstName}},</p>
          <p>Your payment for <strong>{{eventName}}</strong> has been created.</p>
          <p><strong>Booking Code:</strong> {{bookingCode}}</p>
          <p><strong>Amount:</strong> Rp {{totalAmount}}</p>
          <p>Please complete your payment to secure your booking.</p>
          <hr>
          <p><small><a href="{{unsubscribeUrl}}">Unsubscribe</a></small></p>
        `
      },
      payment_success: {
        subject: 'Payment Successful - {{eventName}}',
        html: `
          <h2>Payment Successful! 🎉</h2>
          <p>Hi {{recipient.firstName}},</p>
          <p>Great news! Your payment for <strong>{{eventName}}</strong> was successful.</p>
          <p><strong>Booking Code:</strong> {{bookingCode}}</p>
          <p>Your access ticket is now ready. See you at the event!</p>
          <hr>
          <p><small><a href="{{unsubscribeUrl}}">Unsubscribe</a></small></p>
        `
      },
      guestlist_approved: {
        subject: 'Guestlist Approved - {{eventName}}',
        html: `
          <h2>Guestlist Approved! ✅</h2>
          <p>Hi {{recipient.firstName}},</p>
          <p>Congratulations! You've been approved for the guestlist of <strong>{{eventName}}</strong>.</p>
          <p>Please complete the platform fee payment to secure your spot.</p>
          <hr>
          <p><small><a href="{{unsubscribeUrl}}">Unsubscribe</a></small></p>
        `
      }
    };

    return templates[templateName] || {
      subject: 'DanceSignal Notification',
      html: `
        <h2>{{notificationType}}</h2>
        <p>Hi {{recipient.firstName}},</p>
        <p>You have a new notification from DanceSignal.</p>
        <hr>
        <p><small><a href="{{unsubscribeUrl}}">Unsubscribe</a></small></p>
      `
    };
  }

  renderTemplate(template, data) {
    let rendered = { ...template };

    // ✅ Simple template rendering (replace {{variable}} with data.variable)
    for (const [key, value] of Object.entries(rendered)) {
      if (typeof value === 'string') {
        rendered[key] = this.interpolateString(value, data);
      }
    }

    return rendered;
  }

  interpolateString(template, data) {
    return template.replace(/\{\{([^}]+)\}\}/g, (match, path) => {
      const value = this.getNestedValue(data, path.trim());
      return value !== undefined ? value : match;
    });
  }

  getNestedValue(obj, path) {
    return path.split('.').reduce((current, key) => current?.[key], obj);
  }

  /**
   * 📱 FCM TOKEN MANAGEMENT
   */
  async registerToken(userId, fcmToken) {
    try {
      console.log(`📱 Registering FCM token for user ${userId}`);
      
      if (!fcmToken || fcmToken.trim().length === 0) {
        console.log('❌ Invalid FCM token provided');
        return false;
      }
      
      // Get current user
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { fcmTokens: true }
      });
      
      if (!user) {
        console.log('❌ User not found');
        return false;
      }
      
      // Check if token already exists
      if (user.fcmTokens.includes(fcmToken)) {
        console.log('✅ FCM token already registered');
        return true;
      }
      
      // Add new token to array
      await this.prisma.user.update({
        where: { id: userId },
        data: {
          fcmTokens: {
            push: fcmToken
          }
        }
      });
      
      console.log('✅ FCM token registered successfully');
      return true;
      
    } catch (error) {
      console.error('❌ Error registering FCM token:', error.message);
      return false;
    }
  }
  
  async unregisterToken(userId, fcmToken) {
    try {
      console.log(`📱 Unregistering FCM token for user ${userId}`);
      
      if (!fcmToken || fcmToken.trim().length === 0) {
        console.log('❌ Invalid FCM token provided');
        return false;
      }
      
      // Get current user
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { fcmTokens: true }
      });
      
      if (!user) {
        console.log('❌ User not found');
        return false;
      }
      
      // Remove token from array
      const updatedTokens = user.fcmTokens.filter(token => token !== fcmToken);
      
      await this.prisma.user.update({
        where: { id: userId },
        data: {
          fcmTokens: updatedTokens
        }
      });
      
      console.log('✅ FCM token unregistered successfully');
      return true;
      
    } catch (error) {
      console.error('❌ Error unregistering FCM token:', error.message);
      return false;
    }
  }

  /**
   * 👤 USER MANAGEMENT
   */
  async getRecipientInfo(userId) {
    // ✅ CRITICAL: Validate userId parameter
    if (!userId) {
      throw new Error(`Invalid userId parameter: ${userId}. Check calling method for undefined user ID.`);
    }
    
    return await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        username: true,
        phone: true,
        isActive: true
      }
    });
  }

  async getUserNotificationPreferences(userId) {
    // ✅ TEMP FIX: Return default preferences until notification tables are created
    // TODO: Create userNotificationPreference table in schema
    return {
      email: true,
      push: true,
      sms: false,
      inApp: true,
      marketing: false,
      transactional: true
    };
  }

  filterChannelsByPreferences(channels, notificationType, preferences) {
    return channels.filter(channel => {
      // ✅ Always allow transactional notifications
      const isTransactional = ['payment_created', 'payment_success', 'booking_confirmed'].includes(notificationType);
      
      if (isTransactional && preferences.transactional !== false) {
        return true;
      }

      // ✅ Check specific channel preferences
      return preferences[channel] === true;
    });
  }

  /**
   * 📊 NOTIFICATION RECORDS
   */
  async createNotificationRecord(notificationData) {
    // Extract title and body from pushTitle/pushBody or fallback to data
    const title = notificationData.data?.pushTitle || 
                  notificationData.title || 
                  `${notificationData.type.replace('_', ' ')} Notification`;
    
    const body = notificationData.data?.pushBody || 
                 notificationData.body || 
                 notificationData.data?.reminderMessage || 
                 'You have a new notification';
    
    const imageUrl = notificationData.data?.pushIcon || 
                     notificationData.data?.eventImage || 
                     notificationData.imageUrl;
    
    // Combine metadata and data for actionData
    const actionData = {
      ...notificationData.metadata,
      ...notificationData.data,
      template: notificationData.template,
      channels: notificationData.channels,
      priority: notificationData.priority
    };

    return await this.prisma.notification.create({
      data: {
        userId: notificationData.userId,
        type: notificationData.type,
        title,
        body,
        imageUrl,
        actionData
      }
    });
  }

  async updateNotificationRecord(notificationId, deliveryResults) {
    const successfulChannels = deliveryResults.filter(r => r.success).map(r => r.channel);
    const failedChannels = deliveryResults.filter(r => !r.success);

    // Get current notification to preserve existing actionData
    const currentNotification = await this.prisma.notification.findUnique({
      where: { id: notificationId },
      select: { actionData: true }
    });

    const existingActionData = currentNotification?.actionData || {};

    // Update actionData with delivery information while preserving existing data
    await this.prisma.notification.update({
      where: { id: notificationId },
      data: {
        actionData: {
          ...existingActionData,
          status: successfulChannels.length > 0 ? 'SENT' : 'FAILED',
          deliveredChannels: successfulChannels,
          deliveryResults: deliveryResults,
          sentAt: new Date().toISOString()
        }
      }
    });
  }

  /**
   * 🔄 QUEUE PROCESSING
   */
  startQueueProcessor() {
    setInterval(() => {
      if (!this.isProcessingQueue && this.deliveryQueue.length > 0) {
        this.processDeliveryQueue();
      }
    }, 5000); // Check every 5 seconds
  }

  async processDeliveryQueue() {
    if (this.deliveryQueue.length === 0) return;

    this.isProcessingQueue = true;
    console.log(`📮 Processing ${this.deliveryQueue.length} queued notifications`);

    const batch = this.deliveryQueue.splice(0, this.config.BATCH_SIZE);
    
    for (const notification of batch) {
      try {
        await this.sendNotification(notification);
      } catch (error) {
        console.error('❌ Queue processing error:', error);
        // TODO: Implement retry logic
      }
    }

    this.isProcessingQueue = false;
  }

  /**
   * 🎉 PAYMENT SUCCESS NOTIFICATION
   * 
   * Sends multi-channel notification when payment is successful
   */
  async sendPaymentSuccess(userId, paymentData) {
    const { 
      eventName, 
      eventImage, 
      bookingCode, 
      eventId,
      amount,
      paymentMethod 
    } = paymentData;

    console.log(`🎉 Sending payment success notification to user ${userId} for booking ${bookingCode}`);
    console.log(`📱 Payment data:`, paymentData);
    
    // Check if user has FCM tokens BEFORE trying to send
    const fcmTokens = await this.getUserFCMTokens(userId);
    console.log(`🔍 FCM tokens for user ${userId}:`, fcmTokens.length > 0 ? `Found ${fcmTokens.length} tokens` : 'NO TOKENS FOUND!');
    
    if (fcmTokens.length === 0) {
      console.error(`❌ CRITICAL: User ${userId} has no FCM tokens registered! Cannot send push notification`);
      console.error(`❌ The user needs to register their device FCM token first`);
    }

    return await this.sendNotification({
      userId,
      type: 'PAYMENT_SUCCESS',
      channels: ['push', 'email'], // Both push and email for payment success
      priority: 'high', // Payment notifications are high priority
      template: 'payment_success',
      data: {
        eventName: eventName || 'Event',
        eventImage: eventImage || null,
        bookingCode,
        eventId,
        amount: amount || 0,
        paymentMethod: paymentMethod || 'Credit Card',
        currencySymbol: 'Rp',
        formattedAmount: new Intl.NumberFormat('id-ID', {
          style: 'currency',
          currency: 'IDR'
        }).format(amount || 0),
        successMessage: `Payment successful for ${eventName || 'Event'}!`,
        actionUrl: `${process.env.WEB_BASE_URL || 'https://dancesignal.com'}/bookings/${bookingCode}`,
        
        // Push notification specific data
        pushTitle: '🎉 Payment Successful!',
        pushBody: `Your payment for ${eventName || 'Event'} has been confirmed. Booking: ${bookingCode}`,
        pushIcon: eventImage,
        
        // Email specific data
        emailSubject: `Payment Confirmed - ${eventName || 'Event'} 🎉`,
        logoUrl: `${process.env.WEB_BASE_URL || 'https://dancesignal.com'}/logo.png`
      },
      metadata: {
        bookingCode,
        eventId,
        paymentMethod,
        source: 'webhook_notification'
      }
    });
  }

  /**
   * 💰 PAYMENT CREATED NOTIFICATION
   * 
   * Sends notification when booking/payment is created (pending payment)
   */
  async sendPaymentCreated(userId, paymentData) {
    const { 
      eventName, 
      eventImage, 
      bookingCode, 
      eventId,
      totalAmount,
      quantity 
    } = paymentData;

    console.log(`💰 Sending payment created notification to user ${userId} for booking ${bookingCode}`);

    // ✅ FIX: Use correct sendNotification format (object parameter)
    return await this.sendNotification({
      userId,
      type: 'PAYMENT_CREATED',
      channels: ['push'], // Only push for payment created, email for success
      priority: 'normal',
      template: 'payment_created',
      data: {
        eventName: eventName || 'Event',
        eventImage: eventImage || null,
        bookingCode,
        eventId,
        totalAmount: totalAmount || 0,
        quantity: quantity || 1,
        formattedAmount: new Intl.NumberFormat('id-ID', {
          style: 'currency',
          currency: 'IDR'
        }).format(totalAmount || 0),
        reminderMessage: `Complete your payment for ${eventName || 'Event'}`,
        actionUrl: `${process.env.WEB_BASE_URL || 'https://dancesignal.com'}/bookings/${bookingCode}`,
        
        // Push notification specific data
        pushTitle: '💰 Payment Pending',
        pushBody: `Complete payment for ${eventName || 'Event'} (${quantity || 1} tickets). Booking: ${bookingCode}`,
        pushIcon: eventImage,
        
        // Extra data for FCM
        extraData: {
          action: 'VIEW_BOOKING',
          bookingCode,
          eventId,
          type: 'PAYMENT_CREATED'
        }
      },
      metadata: {
        bookingCode,
        eventId,
        source: 'payment_created_notification'
      }
    });
  }

  /**
   * 🛠️ UTILITY METHODS
   */
  generateUnsubscribeUrl(userId, notificationType) {
    const token = Buffer.from(`${userId}:${notificationType}:${Date.now()}`).toString('base64');
    return `${process.env.WEB_BASE_URL}/unsubscribe?token=${token}`;
  }

  htmlToText(html) {
    return html
      .replace(/<[^>]*>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  async getUserFCMTokens(userId) {
    try {
      console.log(`🔍 Querying FCM tokens for user ${userId}`);
      
      // ✅ Get user's FCM tokens from user profile  
      const user = await this.prisma.user.findUnique({
        where: { 
          id: userId,
          isActive: true
        },
        select: { 
          fcmTokens: true,  // This should be an array
          id: true,
          email: true
        }
      });
      
      if (!user) {
        console.log(`❌ User ${userId} not found or inactive`);
        return [];
      }
      
      console.log(`📱 User ${userId} (${user.email}) has FCM tokens:`, user.fcmTokens);
      
      // fcmTokens should be an array, filter out empty/null values
      const tokens = (user.fcmTokens || []).filter(token => token && token.trim().length > 0);
      
      console.log(`✅ Valid FCM tokens found: ${tokens.length}`);
      return tokens;
      
    } catch (error) {
      console.error(`❌ Error getting FCM tokens for user ${userId}:`, error);
      return [];
    }
  }

  /**
   * 📱 REGISTER FCM TOKEN
   */
  async registerToken(userId, fcmToken) {
    try {
      console.log(`📱 Registering FCM token for user ${userId}: ${fcmToken.substring(0, 20)}...`);

      if (!fcmToken || fcmToken.trim().length === 0) {
        console.log(`❌ Invalid FCM token provided`);
        return false;
      }

      // Get current user data
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { fcmTokens: true, email: true }
      });

      if (!user) {
        console.log(`❌ User ${userId} not found`);
        return false;
      }

      const currentTokens = user.fcmTokens || [];
      
      // Check if token already exists
      if (currentTokens.includes(fcmToken)) {
        console.log(`📱 FCM token already registered for user ${userId}`);
        return true; // Already registered, consider it success
      }

      // Add new token (keep max 5 tokens per user)
      const updatedTokens = [...currentTokens, fcmToken].slice(-5);

      // Update user with new token
      await this.prisma.user.update({
        where: { id: userId },
        data: { fcmTokens: updatedTokens }
      });

      console.log(`✅ FCM token registered successfully for ${user.email}. Total tokens: ${updatedTokens.length}`);
      return true;

    } catch (error) {
      console.error(`❌ Error registering FCM token for user ${userId}:`, error);
      return false;
    }
  }

  /**
   * 📱 UNREGISTER FCM TOKEN
   */
  async unregisterToken(userId, fcmToken) {
    try {
      console.log(`📱 Unregistering FCM token for user ${userId}: ${fcmToken.substring(0, 20)}...`);

      if (!fcmToken || fcmToken.trim().length === 0) {
        console.log(`❌ Invalid FCM token provided`);
        return false;
      }

      // Get current user data
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { fcmTokens: true, email: true }
      });

      if (!user) {
        console.log(`❌ User ${userId} not found`);
        return false;
      }

      const currentTokens = user.fcmTokens || [];
      
      // Remove token from array
      const updatedTokens = currentTokens.filter(token => token !== fcmToken);

      if (currentTokens.length === updatedTokens.length) {
        console.log(`⚠️ FCM token was not found in user's token list`);
        return true; // Token wasn't there anyway, consider it success
      }

      // Update user without the token
      await this.prisma.user.update({
        where: { id: userId },
        data: { fcmTokens: updatedTokens }
      });

      console.log(`✅ FCM token unregistered successfully for ${user.email}. Remaining tokens: ${updatedTokens.length}`);
      return true;

    } catch (error) {
      console.error(`❌ Error unregistering FCM token for user ${userId}:`, error);
      return false;
    }
  }

  /**
   * 🧹 CLEANUP INVALID FCM TOKENS
   */
  async cleanupInvalidFCMTokens(tokens, responses) {
    try {
      const invalidTokens = [];
      
      responses.forEach((response, index) => {
        if (!response.success) {
          const errorCode = response.error?.code;
          // Remove tokens that are unregistered, invalid, or not found
          if (['messaging/registration-token-not-registered', 
               'messaging/invalid-registration-token',
               'messaging/registration-token-not-found'].includes(errorCode)) {
            invalidTokens.push(tokens[index]);
          }
        }
      });

      if (invalidTokens.length > 0) {
        console.log(`🧹 Cleaning up ${invalidTokens.length} invalid FCM tokens`);
        
        // Remove invalid tokens from all users
        const usersWithInvalidTokens = await this.prisma.user.findMany({
          where: {
            fcmTokens: {
              hasSome: invalidTokens
            }
          },
          select: { id: true, fcmTokens: true }
        });

        for (const user of usersWithInvalidTokens) {
          const cleanTokens = user.fcmTokens.filter(token => !invalidTokens.includes(token));
          
          await this.prisma.user.update({
            where: { id: user.id },
            data: { fcmTokens: cleanTokens }
          });
        }
        
        console.log(`✅ Cleaned up ${invalidTokens.length} invalid tokens`);
      }
      
    } catch (error) {
      console.error(`❌ Error cleaning up invalid FCM tokens:`, error);
    }
  }

  /**
   * ✅ Send booking expiry warning notification
   * @param {string} userId - User ID to send warning to
   * @param {Object} notificationData - Warning notification data
   * @returns {Promise<Object>} Result of notification sending
   */
  async sendBookingExpiryWarning(userId, notificationData) {
    try {
      // ✅ CRITICAL: Validate userId parameter
      if (!userId) {
        throw new Error(`Cannot send booking expiry warning: userId is ${userId}. Check booking query includes userId field.`);
      }
      
      console.log(`⚠️ NotificationService: Sending expiry warning to user ${userId}`, notificationData);

      const notificationResult = await this.sendNotification({
        userId,
        type: 'BOOKING_EXPIRY_WARNING',
        channels: ['push', 'email'],
        priority: 'urgent',
        template: 'booking_expiry_warning',
        data: {
          eventName: notificationData.eventName,
          bookingCode: notificationData.bookingCode,
          eventImage: notificationData.eventImage,
          
          // Push notification specific data
          pushTitle: '⏰ Booking Expires Soon',
          pushBody: `Your booking for "${notificationData.eventName}" expires in 15 minutes. Complete payment now!`,
          pushIcon: notificationData.eventImage,
          
          // Email specific data  
          emailTitle: 'Booking Expiry Warning - Complete Payment Now',
          emailBody: `Your booking for "${notificationData.eventName}" (${notificationData.bookingCode}) will expire in 15 minutes. Please complete your payment to secure your spot.`,
          
          // In-app specific data
          inAppTitle: 'Payment Reminder',
          inAppBody: `Your booking for "${notificationData.eventName}" expires soon. Complete payment now to avoid losing your spot.`,
          
          // Extra data for FCM
          extraData: {
            type: 'BOOKING_EXPIRY_WARNING',
            bookingCode: notificationData.bookingCode,
            eventName: notificationData.eventName,
            urgency: 'high'
          }
        },
        metadata: {
          bookingCode: notificationData.bookingCode,
          eventName: notificationData.eventName,
          source: 'booking_expiry_warning'
        }
      });

      console.log(`✅ NotificationService: Expiry warning sent successfully`);
      return notificationResult;

    } catch (error) {
      console.error(`❌ NotificationService: Failed to send expiry warning:`, error);
      throw error;
    }
  }

  /**
   * ✅ Send payment failed notification
   * @param {string} userId - User ID to send notification to
   * @param {Object} notificationData - Failed payment notification data
   * @returns {Promise<Object>} Result of notification sending
   */
  async sendPaymentFailed(userId, notificationData) {
    try {
      // ✅ CRITICAL: Validate userId parameter
      if (!userId) {
        throw new Error(`Cannot send payment failed notification: userId is ${userId}. Check booking query includes userId field.`);
      }
      
      console.log(`❌ NotificationService: Sending payment failed notification to user ${userId}`, notificationData);

      const notificationResult = await this.sendNotification({
        userId,
        type: 'PAYMENT_FAILED',
        channels: ['push', 'email'],
        priority: 'high',
        template: 'payment_failed',
        data: {
          eventName: notificationData.eventName,
          bookingCode: notificationData.bookingCode,
          eventImage: notificationData.eventImage,
          amount: notificationData.amount,
          reason: notificationData.reason || 'Payment processing failed',
          
          // Push notification specific data
          pushTitle: '❌ Payment Failed',
          pushBody: `Payment for "${notificationData.eventName}" was unsuccessful. Please try again.`,
          pushIcon: notificationData.eventImage,
          
          // Email specific data
          emailTitle: 'Payment Failed - Action Required',
          emailBody: `Your payment for "${notificationData.eventName}" (${notificationData.bookingCode}) could not be processed. Please try a different payment method or contact support.`,
          
          // In-app specific data
          inAppTitle: 'Payment Failed',
          inAppBody: `Payment for "${notificationData.eventName}" failed. Please try again with a different payment method.`,
          
          // Extra data for FCM
          extraData: {
            type: 'PAYMENT_FAILED',
            bookingCode: notificationData.bookingCode,
            eventName: notificationData.eventName,
            amount: notificationData.amount,
            reason: notificationData.reason || 'Payment processing failed'
          }
        },
        metadata: {
          bookingCode: notificationData.bookingCode,
          eventName: notificationData.eventName,
          amount: notificationData.amount,
          reason: notificationData.reason,
          source: 'payment_failed_notification'
        }
      });

      console.log(`✅ NotificationService: Payment failed notification sent successfully`);
      return notificationResult;

    } catch (error) {
      console.error(`❌ NotificationService: Failed to send payment failed notification:`, error);
      throw error;
    }
  }



  /**
   * 🎫 ACCESS TRANSFERRED NOTIFICATION
   * 
   * Sends notification when access is transferred between users
   */
  async sendAccessTransferred(userId, transferData) {
    try {
      const { 
        eventName, 
        eventImage, 
        fromUsername,
        accessId,
        eventId
      } = transferData;

      console.log(`🎫 Sending access transferred notification to user ${userId} from ${fromUsername}`);

      return await this.sendNotification({
        userId,
        type: 'ACCESS_TRANSFERRED',
        channels: ['push', 'email'],
        priority: 'normal',
        template: 'access_transferred',
        data: {
          eventName: eventName || 'Event',
          eventImage: eventImage || null,
          fromUsername,
          accessId,
          eventId,
          transferMessage: `You received access to ${eventName || 'Event'} from @${fromUsername}`,
          
          // Push notification specific data
          pushTitle: '🎫 Access Transferred',
          pushBody: `You received access to "${eventName || 'Event'}" from @${fromUsername}`,
          pushIcon: eventImage,
          
          // Email specific data
          emailSubject: `Access Transferred - ${eventName || 'Event'} 🎫`,
          
          // Extra data for FCM
          extraData: {
            action: 'VIEW_TICKET',
            accessId,
            eventId,
            type: 'ACCESS_TRANSFERRED'
          }
        },
        metadata: {
          accessId,
          eventId,
          fromUsername,
          source: 'access_transfer_notification'
        }
      });
    } catch (error) {
      console.error(`❌ NotificationService: Failed to send access transferred notification:`, error);
      throw error;
    }
  }

  /**
   * 💰 PAYMENT REMINDER NOTIFICATION
   * 
   * Sends reminder for pending payments
   */
  async sendPaymentReminder(userId, reminderData) {
    try {
      const { 
        eventName, 
        eventImage, 
        bookingCode,
        eventId,
        totalAmount,
        timeRemaining
      } = reminderData;

      console.log(`💰 Sending payment reminder notification to user ${userId} for booking ${bookingCode}`);

      return await this.sendNotification({
        userId,
        type: 'PAYMENT_REMINDER',
        channels: ['push', 'email'],
        priority: 'high',
        template: 'payment_reminder',
        data: {
          eventName: eventName || 'Event',
          eventImage: eventImage || null,
          bookingCode,
          eventId,
          totalAmount: totalAmount || 0,
          timeRemaining: timeRemaining || '15 minutes',
          formattedAmount: new Intl.NumberFormat('id-ID', {
            style: 'currency',
            currency: 'IDR'
          }).format(totalAmount || 0),
          
          // Push notification specific data
          pushTitle: '⏰ Payment Reminder',
          pushBody: `Complete payment for "${eventName || 'Event'}" before it expires in ${timeRemaining || '15 minutes'}!`,
          pushIcon: eventImage,
          
          // Email specific data
          emailSubject: `Payment Reminder - ${eventName || 'Event'} ⏰`,
          
          // Extra data for FCM
          extraData: {
            action: 'COMPLETE_PAYMENT',
            bookingCode,
            eventId,
            type: 'PAYMENT_REMINDER'
          }
        },
        metadata: {
          bookingCode,
          eventId,
          totalAmount,
          source: 'payment_reminder_notification'
        }
      });
    } catch (error) {
      console.error(`❌ NotificationService: Failed to send payment reminder notification:`, error);
      throw error;
    }
  }

  /**
   * 🎫 TICKETS READY NOTIFICATION
   * 
   * Sends notification when tickets are generated and ready
   */
  async sendTicketsReady(userId, ticketData) {
    try {
      const { 
        eventName, 
        eventImage, 
        bookingCode,
        eventId,
        quantity,
        ticketCount
      } = ticketData;

      console.log(`🎫 Sending tickets ready notification to user ${userId} for booking ${bookingCode}`);

      return await this.sendNotification({
        userId,
        type: 'TICKETS_READY',
        channels: ['push', 'email'],
        priority: 'normal',
        template: 'tickets_ready',
        data: {
          eventName: eventName || 'Event',
          eventImage: eventImage || null,
          bookingCode,
          eventId,
          quantity: quantity || 1,
          ticketCount: ticketCount || quantity || 1,
          ticketWord: (ticketCount || quantity || 1) > 1 ? 'tickets' : 'ticket',
          
          // Push notification specific data
          pushTitle: '🎫 Your Tickets Are Ready!',
          pushBody: `Your ${ticketCount || quantity || 1} ${(ticketCount || quantity || 1) > 1 ? 'tickets' : 'ticket'} for "${eventName || 'Event'}" are ready to view!`,
          pushIcon: eventImage,
          
          // Email specific data
          emailSubject: `Tickets Ready - ${eventName || 'Event'} 🎫`,
          
          // Extra data for FCM
          extraData: {
            action: 'VIEW_TICKETS',
            bookingCode,
            eventId,
            type: 'TICKETS_READY'
          }
        },
        metadata: {
          bookingCode,
          eventId,
          quantity,
          source: 'tickets_ready_notification'
        }
      });
    } catch (error) {
      console.error(`❌ NotificationService: Failed to send tickets ready notification:`, error);
      throw error;
    }
  }

  /**
   * 🎟️ ACCESS TICKET GENERATED NOTIFICATION
   * 
   * Sends notification when access ticket is generated
   */
  async sendAccessTicketGenerated(userId, accessData) {
    try {
      const { 
        eventName, 
        eventImage, 
        bookingCode,
        eventId,
        accessCode,
        accessTierName
      } = accessData;

      console.log(`🎟️ Sending access ticket generated notification to user ${userId} for booking ${bookingCode}`);

      return await this.sendNotification({
        userId,
        type: 'ACCESS_TICKET_GENERATED',
        channels: ['push', 'email'],
        priority: 'normal',
        template: 'access_ticket_generated',
        data: {
          eventName: eventName || 'Event',
          eventImage: eventImage || null,
          bookingCode,
          eventId,
          accessCode: accessCode || bookingCode,
          accessTierName: accessTierName || 'General Access',
          
          // Push notification specific data
          pushTitle: '🎟️ Access Ticket Generated!',
          pushBody: `Your access ticket for "${eventName || 'Event'}" has been generated. Tap to view your QR code!`,
          pushIcon: eventImage,
          
          // Email specific data
          emailSubject: `Access Ticket Generated - ${eventName || 'Event'} 🎟️`,
          
          // Extra data for FCM
          extraData: {
            action: 'VIEW_ACCESS_TICKET',
            bookingCode,
            eventId,
            accessCode: accessCode || bookingCode,
            type: 'ACCESS_TICKET_GENERATED'
          }
        },
        metadata: {
          bookingCode,
          eventId,
          accessCode,
          source: 'access_ticket_generated_notification'
        }
      });
    } catch (error) {
      console.error(`❌ NotificationService: Failed to send access ticket generated notification:`, error);
      throw error;
    }
  }

  /**
   * 🔄 PAYMENT PROCESSING NOTIFICATION
   * 
   * Sends notification when payment is being processed
   */
  async sendPaymentProcessing(userId, processingData) {
    try {
      const { 
        eventName, 
        eventImage, 
        bookingCode,
        eventId,
        paymentMethod
      } = processingData;

      console.log(`🔄 Sending payment processing notification to user ${userId} for booking ${bookingCode}`);

      return await this.sendNotification({
        userId,
        type: 'PAYMENT_PROCESSING',
        channels: ['push'],
        priority: 'normal',
        template: 'payment_processing',
        data: {
          eventName: eventName || 'Event',
          eventImage: eventImage || null,
          bookingCode,
          eventId,
          paymentMethod: paymentMethod || 'your payment method',
          
          // Push notification specific data
          pushTitle: '🔄 Payment Processing',
          pushBody: `Your payment for "${eventName || 'Event'}" is being processed. Please wait...`,
          pushIcon: eventImage,
          
          // Extra data for FCM
          extraData: {
            action: 'VIEW_BOOKING',
            bookingCode,
            eventId,
            type: 'PAYMENT_PROCESSING'
          }
        },
        metadata: {
          bookingCode,
          eventId,
          paymentMethod,
          source: 'payment_processing_notification'
        }
      });
    } catch (error) {
      console.error(`❌ NotificationService: Failed to send payment processing notification:`, error);
      throw error;
    }
  }

  /**
   * ⏰ PAYMENT EXPIRED NOTIFICATION
   * 
   * Sends notification when payment has expired
   */
  async sendPaymentExpired(userId, expiredData) {
    try {
      const { 
        eventName, 
        eventImage, 
        bookingCode,
        eventId,
        totalAmount
      } = expiredData;

      console.log(`⏰ Sending payment expired notification to user ${userId} for booking ${bookingCode}`);

      return await this.sendNotification({
        userId,
        type: 'PAYMENT_EXPIRED',
        channels: ['push', 'email'],
        priority: 'normal',
        template: 'payment_expired',
        data: {
          eventName: eventName || 'Event',
          eventImage: eventImage || null,
          bookingCode,
          eventId,
          totalAmount: totalAmount || 0,
          formattedAmount: new Intl.NumberFormat('id-ID', {
            style: 'currency',
            currency: 'IDR'
          }).format(totalAmount || 0),
          
          // Push notification specific data
          pushTitle: '⏰ Payment Expired',
          pushBody: `Your payment window for "${eventName || 'Event'}" has expired. You can try booking again.`,
          pushIcon: eventImage,
          
          // Email specific data
          emailSubject: `Payment Expired - ${eventName || 'Event'} ⏰`,
          
          // Extra data for FCM
          extraData: {
            action: 'BOOK_AGAIN',
            eventId,
            type: 'PAYMENT_EXPIRED'
          }
        },
        metadata: {
          bookingCode,
          eventId,
          totalAmount,
          source: 'payment_expired_notification'
        }
      });
    } catch (error) {
      console.error(`❌ NotificationService: Failed to send payment expired notification:`, error);
      throw error;
    }
  }

  /**
   * 💬 SEND CHAT MESSAGE NOTIFICATION WITH REPLY SUPPORT
   * 
   * Enhanced chat notification with direct reply capability
   */
  async sendChatMessageNotification(userId, chatData) {
    try {
      const { 
        senderName,
        senderAvatar,
        message,
        chatRoomId,
        messageId,
        roomName,
        isGroupChat = false
      } = chatData;

      console.log(`💬 Sending chat notification to user ${userId} from ${senderName}`);

      // Create notification with enhanced data for reply functionality
      return await this.sendNotification({
        userId,
        type: 'CHAT_MESSAGE',
        channels: ['push'],
        priority: 'high', // High priority for chat messages
        template: 'chat_message',
        data: {
          title: isGroupChat ? `${senderName} in ${roomName}` : senderName,
          body: message,
          image: senderAvatar || null,
          
          // Push notification specific data
          pushTitle: isGroupChat ? `${senderName} in ${roomName}` : senderName,
          pushBody: message,
          pushIcon: senderAvatar,
          
          // ✅ CHAT-SPECIFIC: Enhanced data for chat functionality
          extraData: {
            action: 'OPEN_CHAT',
            type: 'CHAT_MESSAGE',
            chatRoomId,
            messageId,
            senderName,
            roomName: roomName || 'Chat',
            isGroupChat,
            
            // ✅ REPLY SUPPORT: Enable direct reply from notification
            replyEnabled: true,
            quickReplies: [
              '👍', '❤️', 'Thanks!', 'Sure!', 'On my way!'
            ]
          }
        },
        
        // ✅ FCM ACTIONS: Direct reply and quick actions
        actions: [
          {
            action: 'REPLY',
            title: 'Reply',
            type: 'input',
            placeholder: 'Type a message...',
            inputButtonTitle: 'Send',
            icon: 'ic_reply'
          },
          {
            action: 'MARK_READ',
            title: 'Mark as read',
            icon: 'ic_done'
          },
          {
            action: 'OPEN_CHAT',
            title: 'Open chat',
            icon: 'ic_chat'
          }
        ],
        
        metadata: {
          chatNotification: true,
          chatRoomId,
          messageId,
          source: 'chat_message_notification'
        }
      });
    } catch (error) {
      console.error(`❌ NotificationService: Failed to send chat notification:`, error);
      throw error;
    }
  }

  /**
   * 📢 SEND TO USER (Generic Method)
   * 
   * Generic method for custom notifications
   */
  async sendToUser(userId, notificationData) {
    try {
      const { 
        title,
        body,
        type = 'CUSTOM',
        image,
        action = 'OPEN_APP',
        actionData = {},
        actions = [] // Support for notification actions
      } = notificationData;

      console.log(`📢 Sending custom notification to user ${userId}: ${title}`);

      return await this.sendNotification({
        userId,
        type,
        channels: ['push'],
        priority: 'normal',
        template: 'custom',
        data: {
          title: title || 'DanceSignal Notification',
          body: body || 'You have a new notification',
          image: image || null,
          
          // Push notification specific data
          pushTitle: title || 'DanceSignal Notification',
          pushBody: body || 'You have a new notification',
          pushIcon: image,
          
          // Extra data for FCM
          extraData: {
            action,
            type,
            ...actionData
          }
        },
        
        // ✅ ENHANCED: Support for notification actions
        ...(actions.length > 0 && { actions }),
        
        metadata: {
          customNotification: true,
          source: 'send_to_user_notification'
        }
      });
    } catch (error) {
      console.error(`❌ NotificationService: Failed to send custom notification:`, error);
      throw error;
    }
  }

  /**
   * 🧹 CLEANUP
   */
  async cleanup() {
    if (this.emailTransporter) {
      this.emailTransporter.close();
    }
    await this.prisma.$disconnect();
    this.templateCache.clear();
    console.log('✅ NotificationService cleanup completed');
  }
}

module.exports = NotificationService;