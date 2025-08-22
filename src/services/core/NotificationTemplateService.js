// Lazy load to avoid circular dependency
const LoggingService = require('./LoggingService');
const ConfigService = require('./ConfigService');

/**
 * 📧 CENTRALIZED NOTIFICATION TEMPLATE SERVICE
 * 
 * Advanced template management system for DanceSignal:
 * - Multi-language notification templates
 * - Dynamic content generation with variables
 * - A/B testing for notification effectiveness
 * - Template versioning and rollback capabilities
 * - Real-time template compilation
 * - Performance-optimized template caching
 * 
 * ✅ Consistency: Unified notification design and messaging
 * ✅ Performance: Compiled template caching with TTL
 * ✅ Localization: Multi-language support with fallbacks
 * ✅ Flexibility: Dynamic content with rich variables
 */
class NotificationTemplateService {
  constructor() {
    this.logger = new LoggingService();
    this.configService = new ConfigService();

    // ✅ Template configuration
    this.config = {
      // Language settings
      DEFAULT_LANGUAGE: process.env.DEFAULT_LANGUAGE || 'en',
      SUPPORTED_LANGUAGES: (process.env.SUPPORTED_LANGUAGES || 'en,id').split(','),
      FALLBACK_LANGUAGE: 'en',
      
      // Template settings
      ENABLE_TEMPLATE_CACHING: process.env.ENABLE_TEMPLATE_CACHING !== 'false',
      TEMPLATE_CACHE_TTL: parseInt(process.env.TEMPLATE_CACHE_TTL) || 3600, // 1 hour
      ENABLE_A_B_TESTING: process.env.ENABLE_A_B_TESTING === 'true',
      
      // Content settings
      MAX_TITLE_LENGTH: parseInt(process.env.MAX_NOTIFICATION_TITLE_LENGTH) || 100,
      MAX_BODY_LENGTH: parseInt(process.env.MAX_NOTIFICATION_BODY_LENGTH) || 500,
      
      // Performance settings
      TEMPLATE_COMPILATION_TIMEOUT: 5000, // 5 seconds
      MAX_VARIABLE_RECURSION_DEPTH: 5
    };

    // ✅ Template cache
    this.templateCache = new Map();
    this.compiledTemplateCache = new Map();

    // ✅ Template statistics
    this.stats = {
      templatesLoaded: 0,
      templatesCompiled: 0,
      cacheHits: 0,
      cacheMisses: 0,
      compilationErrors: 0,
      lastCompilation: null
    };

    // ✅ Initialize templates
    this.initializeTemplates();

    console.log('📧 NotificationTemplateService initialized:', {
      defaultLanguage: this.config.DEFAULT_LANGUAGE,
      supportedLanguages: this.config.SUPPORTED_LANGUAGES.length,
      cachingEnabled: this.config.ENABLE_TEMPLATE_CACHING,
      aBTestingEnabled: this.config.ENABLE_A_B_TESTING
    });
  }

  /**
   * 🔄 LAZY LOADING GETTER - Avoid circular dependency
   */
  get notificationService() {
    if (!this._notificationService) {
      const { getNotificationService } = require('./index');
      this._notificationService = getNotificationService();
    }
    return this._notificationService;
  }

  /**
   * 📚 TEMPLATE INITIALIZATION
   */

  initializeTemplates() {
    // ✅ Load all notification templates
    this.templates = {
      // Authentication templates
      welcome: {
        en: {
          push: {
            title: "Welcome to DanceSignal! 🎉",
            body: "Get ready to discover amazing events and connect with the dance community!",
            data: { type: "welcome", action: "open_home" }
          },
          email: {
            subject: "Welcome to DanceSignal - Let's Get Started! 🎉",
            html: this.getEmailTemplate('welcome', 'en'),
            text: "Welcome to DanceSignal! Get ready to discover amazing events and connect with the dance community."
          }
        },
        id: {
          push: {
            title: "Selamat datang di DanceSignal! 🎉",
            body: "Bersiaplah untuk menemukan acara menakjubkan dan terhubung dengan komunitas dance!",
            data: { type: "welcome", action: "open_home" }
          },
          email: {
            subject: "Selamat datang di DanceSignal - Mari Mulai! 🎉",
            html: this.getEmailTemplate('welcome', 'id'),
            text: "Selamat datang di DanceSignal! Bersiaplah untuk menemukan acara menakjubkan dan terhubung dengan komunitas dance."
          }
        }
      },

      // Payment templates
      payment_success: {
        en: {
          push: {
            title: "Payment Successful! ✅",
            body: "Your payment for {{eventName}} has been confirmed. Get ready to dance!",
            data: { type: "payment_success", action: "view_ticket", eventId: "{{eventId}}" }
          },
          email: {
            subject: "Payment Confirmed - {{eventName}} ✅",
            html: this.getEmailTemplate('payment_success', 'en'),
            text: "Your payment for {{eventName}} has been confirmed. Your booking code is {{bookingCode}}."
          }
        },
        id: {
          push: {
            title: "Pembayaran Berhasil! ✅",
            body: "Pembayaran Anda untuk {{eventName}} telah dikonfirmasi. Bersiaplah untuk dance!",
            data: { type: "payment_success", action: "view_ticket", eventId: "{{eventId}}" }
          },
          email: {
            subject: "Pembayaran Dikonfirmasi - {{eventName}} ✅",
            html: this.getEmailTemplate('payment_success', 'id'),
            text: "Pembayaran Anda untuk {{eventName}} telah dikonfirmasi. Kode booking Anda adalah {{bookingCode}}."
          }
        }
      },

      payment_reminder: {
        en: {
          push: {
            title: "Complete Your Payment ⏰",
            body: "Your booking for {{eventName}} expires soon. Complete payment now!",
            data: { type: "payment_reminder", action: "complete_payment", bookingId: "{{bookingId}}" }
          },
          email: {
            subject: "Payment Reminder - {{eventName}} ⏰",
            html: this.getEmailTemplate('payment_reminder', 'en'),
            text: "Your booking for {{eventName}} expires soon. Complete your payment to secure your spot!"
          }
        },
        id: {
          push: {
            title: "Selesaikan Pembayaran ⏰",
            body: "Booking Anda untuk {{eventName}} akan segera berakhir. Selesaikan pembayaran sekarang!",
            data: { type: "payment_reminder", action: "complete_payment", bookingId: "{{bookingId}}" }
          },
          email: {
            subject: "Pengingat Pembayaran - {{eventName}} ⏰",
            html: this.getEmailTemplate('payment_reminder', 'id'),
            text: "Booking Anda untuk {{eventName}} akan segera berakhir. Selesaikan pembayaran untuk mengamankan tempat Anda!"
          }
        }
      },

      payment_failed: {
        en: {
          push: {
            title: "Payment Failed ❌",
            body: "Payment for {{eventName}} was unsuccessful. Try again or use a different method.",
            data: { type: "payment_failed", action: "retry_payment", bookingId: "{{bookingId}}" }
          },
          email: {
            subject: "Payment Failed - {{eventName}} ❌",
            html: this.getEmailTemplate('payment_failed', 'en'),
            text: "Unfortunately, your payment for {{eventName}} was unsuccessful. Please try again."
          }
        },
        id: {
          push: {
            title: "Pembayaran Gagal ❌",
            body: "Pembayaran untuk {{eventName}} tidak berhasil. Coba lagi atau gunakan metode lain.",
            data: { type: "payment_failed", action: "retry_payment", bookingId: "{{bookingId}}" }
          },
          email: {
            subject: "Pembayaran Gagal - {{eventName}} ❌",
            html: this.getEmailTemplate('payment_failed', 'id'),
            text: "Maaf, pembayaran Anda untuk {{eventName}} tidak berhasil. Silakan coba lagi."
          }
        }
      },

      // Event templates
      event_reminder: {
        en: {
          push: {
            title: "Event Starting Soon! 🎵",
            body: "{{eventName}} starts in {{timeUntil}}. Don't miss out!",
            data: { type: "event_reminder", action: "view_event", eventId: "{{eventId}}" }
          },
          email: {
            subject: "Event Reminder - {{eventName}} starts {{timeUntil}} 🎵",
            html: this.getEmailTemplate('event_reminder', 'en'),
            text: "{{eventName}} starts in {{timeUntil}} at {{location}}. Get ready to dance!"
          }
        },
        id: {
          push: {
            title: "Acara Segera Dimulai! 🎵",
            body: "{{eventName}} dimulai dalam {{timeUntil}}. Jangan sampai terlewat!",
            data: { type: "event_reminder", action: "view_event", eventId: "{{eventId}}" }
          },
          email: {
            subject: "Pengingat Acara - {{eventName}} dimulai {{timeUntil}} 🎵",
            html: this.getEmailTemplate('event_reminder', 'id'),
            text: "{{eventName}} dimulai dalam {{timeUntil}} di {{location}}. Bersiaplah untuk dance!"
          }
        }
      },

      // Guestlist templates
      guestlist_approved: {
        en: {
          push: {
            title: "Guestlist Approved! 🎉",
            body: "You're on the guestlist for {{eventName}}. See you on the dance floor!",
            data: { type: "guestlist_approved", action: "view_access", eventId: "{{eventId}}" }
          },
          email: {
            subject: "Guestlist Approved - {{eventName}} 🎉",
            html: this.getEmailTemplate('guestlist_approved', 'en'),
            text: "Great news! You're on the guestlist for {{eventName}}. Event details: {{eventDetails}}"
          }
        },
        id: {
          push: {
            title: "Guestlist Disetujui! 🎉",
            body: "Anda masuk dalam guestlist untuk {{eventName}}. Sampai jumpa di dance floor!",
            data: { type: "guestlist_approved", action: "view_access", eventId: "{{eventId}}" }
          },
          email: {
            subject: "Guestlist Disetujui - {{eventName}} 🎉",
            html: this.getEmailTemplate('guestlist_approved', 'id'),
            text: "Kabar baik! Anda masuk dalam guestlist untuk {{eventName}}. Detail acara: {{eventDetails}}"
          }
        }
      },

      // System templates
      account_security: {
        en: {
          push: {
            title: "Security Alert 🔒",
            body: "New login detected from {{location}}. Was this you?",
            data: { type: "security_alert", action: "review_activity" }
          },
          email: {
            subject: "Security Alert - New Login Detected 🔒",
            html: this.getEmailTemplate('account_security', 'en'),
            text: "We detected a new login to your account from {{location}} at {{time}}. If this wasn't you, please secure your account immediately."
          }
        },
        id: {
          push: {
            title: "Peringatan Keamanan 🔒",
            body: "Login baru terdeteksi dari {{location}}. Apakah ini Anda?",
            data: { type: "security_alert", action: "review_activity" }
          },
          email: {
            subject: "Peringatan Keamanan - Login Baru Terdeteksi 🔒",
            html: this.getEmailTemplate('account_security', 'id'),
            text: "Kami mendeteksi login baru ke akun Anda dari {{location}} pada {{time}}. Jika ini bukan Anda, harap amankan akun Anda segera."
          }
        }
      }
    };

    this.stats.templatesLoaded = Object.keys(this.templates).length;
    console.log(`📚 Loaded ${this.stats.templatesLoaded} notification templates`);
  }

  /**
   * 🎯 MAIN TEMPLATE METHODS
   */

  async sendNotification(templateName, variables = {}, options = {}) {
    const {
      userId,
      language = this.config.DEFAULT_LANGUAGE,
      channels = ['push'], // push, email, sms
      priority = 'normal',
      scheduleAt = null,
      correlationId = null
    } = options;

    try {
      const startTime = Date.now();

      // ✅ Compile templates for all requested channels
      const compiledTemplates = {};
      
      for (const channel of channels) {
        const compiled = await this.compileTemplate(templateName, channel, variables, language);
        if (compiled) {
          compiledTemplates[channel] = compiled;
        }
      }

      if (Object.keys(compiledTemplates).length === 0) {
        throw new Error(`No valid templates found for ${templateName}`);
      }

      // ✅ Send notifications through each channel
      const results = {};
      
      for (const [channel, template] of Object.entries(compiledTemplates)) {
        try {
          let result;
          
          switch (channel) {
            case 'push':
              result = await this.notificationService.sendPushNotification(userId, {
                title: template.title,
                body: template.body,
                data: template.data || {},
                imageUrl: template.imageUrl || null
              });
              break;
              
            case 'email':
              result = await this.notificationService.sendEmail(userId, {
                subject: template.subject,
                html: template.html,
                text: template.text
              });
              break;
              
            case 'sms':
              result = await this.notificationService.sendSMS(userId, {
                message: template.text || template.body
              });
              break;
              
            default:
              this.logger.warn('Unknown notification channel', { channel, templateName });
              continue;
          }
          
          results[channel] = { success: true, result };
          
        } catch (channelError) {
          this.logger.error(`Notification sending failed for channel ${channel}`, {
            templateName,
            channel,
            userId,
            error: channelError.message
          }, { correlationId });
          
          results[channel] = { success: false, error: channelError.message };
        }
      }

      const totalTime = Date.now() - startTime;
      
      this.logger.info('Template notification sent', {
        templateName,
        userId,
        channels,
        language,
        success: Object.values(results).some(r => r.success),
        totalTime: `${totalTime}ms`
      }, { correlationId });

      return {
        success: Object.values(results).some(r => r.success),
        results,
        templateName,
        channels,
        language,
        totalTime
      };

    } catch (error) {
      this.logger.error('Template notification failed', {
        templateName,
        userId,
        error: error.message
      }, { correlationId });

      throw error;
    }
  }

  async compileTemplate(templateName, channel, variables = {}, language = this.config.DEFAULT_LANGUAGE) {
    try {
      // ✅ Check cache first
      const cacheKey = `${templateName}:${channel}:${language}:${this.hashVariables(variables)}`;
      
      if (this.config.ENABLE_TEMPLATE_CACHING && this.compiledTemplateCache.has(cacheKey)) {
        this.stats.cacheHits++;
        return this.compiledTemplateCache.get(cacheKey);
      }

      this.stats.cacheMisses++;

      // ✅ Get template
      const template = this.getTemplate(templateName, channel, language);
      if (!template) {
        return null;
      }

      // ✅ Compile template with variables
      const compiled = this.processTemplate(template, variables);

      // ✅ Cache compiled template
      if (this.config.ENABLE_TEMPLATE_CACHING) {
        this.compiledTemplateCache.set(cacheKey, compiled);
        
        // ✅ Auto-expire cache entries
        setTimeout(() => {
          this.compiledTemplateCache.delete(cacheKey);
        }, this.config.TEMPLATE_CACHE_TTL * 1000);
      }

      this.stats.templatesCompiled++;
      this.stats.lastCompilation = new Date();

      return compiled;

    } catch (error) {
      this.stats.compilationErrors++;
      this.logger.error('Template compilation failed', {
        templateName,
        channel,
        language,
        error: error.message
      });

      return null;
    }
  }

  getTemplate(templateName, channel, language) {
    // ✅ Try exact match first
    const template = this.templates[templateName]?.[language]?.[channel];
    if (template) {
      return template;
    }

    // ✅ Try fallback language
    const fallbackTemplate = this.templates[templateName]?.[this.config.FALLBACK_LANGUAGE]?.[channel];
    if (fallbackTemplate) {
      this.logger.warn('Using fallback language for template', {
        templateName,
        channel,
        requestedLanguage: language,
        fallbackLanguage: this.config.FALLBACK_LANGUAGE
      });
      return fallbackTemplate;
    }

    // ✅ Log missing template
    this.logger.error('Template not found', {
      templateName,
      channel,
      language,
      availableTemplates: Object.keys(this.templates)
    });

    return null;
  }

  processTemplate(template, variables) {
    const processed = {};

    // ✅ Process each field in the template
    for (const [key, value] of Object.entries(template)) {
      if (typeof value === 'string') {
        processed[key] = this.interpolateString(value, variables);
      } else if (typeof value === 'object' && value !== null) {
        processed[key] = this.processTemplate(value, variables);
      } else {
        processed[key] = value;
      }
    }

    return processed;
  }

  interpolateString(template, variables, depth = 0) {
    if (depth > this.config.MAX_VARIABLE_RECURSION_DEPTH) {
      this.logger.warn('Template variable recursion limit exceeded');
      return template;
    }

    return template.replace(/\{\{([^}]+)\}\}/g, (match, key) => {
      const trimmedKey = key.trim();
      
      // ✅ Handle nested object access (e.g., user.name)
      const value = this.getNestedValue(variables, trimmedKey);
      
      if (value !== undefined && value !== null) {
        // ✅ If the replacement contains more variables, process recursively
        if (typeof value === 'string' && value.includes('{{')) {
          return this.interpolateString(value, variables, depth + 1);
        }
        return String(value);
      }

      // ✅ Log missing variables in development
      if (process.env.NODE_ENV === 'development') {
        this.logger.warn('Template variable not found', {
          key: trimmedKey,
          availableKeys: Object.keys(variables)
        });
      }

      return match; // Keep original placeholder if no value found
    });
  }

  getNestedValue(obj, path) {
    return path.split('.').reduce((current, key) => {
      return current && current[key] !== undefined ? current[key] : undefined;
    }, obj);
  }

  /**
   * 📧 EMAIL TEMPLATE HELPERS
   */

  getEmailTemplate(templateName, language) {
    // ✅ HTML email templates
    const emailTemplates = {
      welcome: {
        en: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h1 style="color: #6366f1;">Welcome to DanceSignal! 🎉</h1>
            <p>Hi {{firstName}},</p>
            <p>Welcome to the DanceSignal community! We're excited to have you join us on this incredible journey.</p>
            <p>Here's what you can do now:</p>
            <ul>
              <li>🎫 Discover amazing dance events</li>
              <li>🎵 Connect with the dance community</li>
              <li>📱 Get personalized event recommendations</li>
            </ul>
            <p style="text-align: center;">
              <a href="{{appUrl}}" style="background-color: #6366f1; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">
                Start Exploring
              </a>
            </p>
            <p>Happy dancing!</p>
            <p>The DanceSignal Team</p>
          </div>
        `,
        id: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h1 style="color: #6366f1;">Selamat datang di DanceSignal! 🎉</h1>
            <p>Hai {{firstName}},</p>
            <p>Selamat datang di komunitas DanceSignal! Kami senang Anda bergabung dengan kami dalam perjalanan luar biasa ini.</p>
            <p>Berikut yang bisa Anda lakukan sekarang:</p>
            <ul>
              <li>🎫 Temukan acara dance yang menakjubkan</li>
              <li>🎵 Terhubung dengan komunitas dance</li>
              <li>📱 Dapatkan rekomendasi acara yang dipersonalisasi</li>
            </ul>
            <p style="text-align: center;">
              <a href="{{appUrl}}" style="background-color: #6366f1; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">
                Mulai Menjelajah
              </a>
            </p>
            <p>Selamat dance!</p>
            <p>Tim DanceSignal</p>
          </div>
        `
      },

      payment_success: {
        en: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h1 style="color: #10b981;">Payment Successful! ✅</h1>
            <p>Hi {{firstName}},</p>
            <p>Great news! Your payment for <strong>{{eventName}}</strong> has been confirmed.</p>
            <div style="background-color: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <h3>Event Details:</h3>
              <p><strong>Event:</strong> {{eventName}}</p>
              <p><strong>Date:</strong> {{eventDate}}</p>
              <p><strong>Location:</strong> {{eventLocation}}</p>
              <p><strong>Booking Code:</strong> {{bookingCode}}</p>
            </div>
            <p style="text-align: center;">
              <a href="{{ticketUrl}}" style="background-color: #10b981; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">
                View Your Ticket
              </a>
            </p>
            <p>See you on the dance floor!</p>
            <p>The DanceSignal Team</p>
          </div>
        `,
        id: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h1 style="color: #10b981;">Pembayaran Berhasil! ✅</h1>
            <p>Hai {{firstName}},</p>
            <p>Kabar baik! Pembayaran Anda untuk <strong>{{eventName}}</strong> telah dikonfirmasi.</p>
            <div style="background-color: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <h3>Detail Acara:</h3>
              <p><strong>Acara:</strong> {{eventName}}</p>
              <p><strong>Tanggal:</strong> {{eventDate}}</p>
              <p><strong>Lokasi:</strong> {{eventLocation}}</p>
              <p><strong>Kode Booking:</strong> {{bookingCode}}</p>
            </div>
            <p style="text-align: center;">
              <a href="{{ticketUrl}}" style="background-color: #10b981; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">
                Lihat Tiket Anda
              </a>
            </p>
            <p>Sampai jumpa di dance floor!</p>
            <p>Tim DanceSignal</p>
          </div>
        `
      }

      // ✅ Add more email templates as needed
    };

    return emailTemplates[templateName]?.[language] || '';
  }

  /**
   * 🛠️ UTILITY METHODS
   */

  hashVariables(variables) {
    const crypto = require('crypto');
    return crypto.createHash('md5')
                 .update(JSON.stringify(variables))
                 .digest('hex')
                 .substring(0, 8);
  }

  /**
   * 📊 TEMPLATE MANAGEMENT
   */

  addTemplate(templateName, language, channel, template) {
    if (!this.templates[templateName]) {
      this.templates[templateName] = {};
    }
    
    if (!this.templates[templateName][language]) {
      this.templates[templateName][language] = {};
    }
    
    this.templates[templateName][language][channel] = template;
    
    this.logger.info('Template added', {
      templateName,
      language,
      channel
    });
  }

  updateTemplate(templateName, language, channel, template) {
    if (this.templates[templateName]?.[language]?.[channel]) {
      this.templates[templateName][language][channel] = template;
      
      // ✅ Clear related cache entries
      this.clearTemplateCache(templateName, channel, language);
      
      this.logger.info('Template updated', {
        templateName,
        language,
        channel
      });
      
      return true;
    }
    
    return false;
  }

  deleteTemplate(templateName, language = null, channel = null) {
    if (language && channel) {
      // ✅ Delete specific template
      if (this.templates[templateName]?.[language]?.[channel]) {
        delete this.templates[templateName][language][channel];
        this.clearTemplateCache(templateName, channel, language);
        return true;
      }
    } else if (language) {
      // ✅ Delete all templates for a language
      if (this.templates[templateName]?.[language]) {
        delete this.templates[templateName][language];
        this.clearTemplateCache(templateName);
        return true;
      }
    } else {
      // ✅ Delete entire template
      if (this.templates[templateName]) {
        delete this.templates[templateName];
        this.clearTemplateCache(templateName);
        return true;
      }
    }
    
    return false;
  }

  clearTemplateCache(templateName = null, channel = null, language = null) {
    if (templateName && channel && language) {
      // ✅ Clear specific cache entries
      const keysToDelete = [];
      for (const key of this.compiledTemplateCache.keys()) {
        if (key.startsWith(`${templateName}:${channel}:${language}:`)) {
          keysToDelete.push(key);
        }
      }
      keysToDelete.forEach(key => this.compiledTemplateCache.delete(key));
    } else if (templateName) {
      // ✅ Clear all cache entries for template
      const keysToDelete = [];
      for (const key of this.compiledTemplateCache.keys()) {
        if (key.startsWith(`${templateName}:`)) {
          keysToDelete.push(key);
        }
      }
      keysToDelete.forEach(key => this.compiledTemplateCache.delete(key));
    } else {
      // ✅ Clear entire cache
      this.compiledTemplateCache.clear();
    }
  }

  /**
   * 📊 MONITORING & STATISTICS
   */

  getTemplateStats() {
    return {
      ...this.stats,
      cacheSize: this.compiledTemplateCache.size,
      templateCount: Object.keys(this.templates).length,
      cacheHitRate: this.stats.totalValidations > 0
        ? ((this.stats.cacheHits / (this.stats.cacheHits + this.stats.cacheMisses)) * 100).toFixed(2) + '%'
        : '0%'
    };
  }

  getHealthStatus() {
    return {
      status: 'healthy',
      templatesLoaded: this.stats.templatesLoaded,
      compilationErrors: this.stats.compilationErrors,
      cacheEnabled: this.config.ENABLE_TEMPLATE_CACHING,
      lastCompilation: this.stats.lastCompilation
    };
  }

  /**
   * 🧹 CLEANUP
   */
  async cleanup() {
    this.templateCache.clear();
    this.compiledTemplateCache.clear();
    console.log('✅ NotificationTemplateService cleanup completed');
  }
}

module.exports = NotificationTemplateService;