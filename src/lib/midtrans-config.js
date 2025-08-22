/**
 * 💳 CENTRALIZED MIDTRANS CONFIGURATION
 * 
 * Enterprise-grade Midtrans configuration service to eliminate
 * duplicate setup across multiple route files.
 */

const midtransClient = require('midtrans-client');

// =============================
// MIDTRANS CONFIGURATION
// =============================

const MIDTRANS_SERVER_KEY = process.env.MIDTRANS_SERVER_KEY;
const MIDTRANS_CLIENT_KEY = process.env.MIDTRANS_CLIENT_KEY;
const MIDTRANS_IS_PRODUCTION = process.env.MIDTRANS_IS_PRODUCTION === 'true';

if (!MIDTRANS_SERVER_KEY || !MIDTRANS_CLIENT_KEY) {
  console.warn('⚠️ Midtrans configuration missing. Payment features may not work.');
}

// =============================
// MIDTRANS CLIENTS (SINGLETON)
// =============================

let snapClient;
let coreApiClient;

/**
 * Get Midtrans Snap client (singleton)
 * @returns {Object} Midtrans Snap client
 */
const getSnapClient = () => {
  if (!snapClient && MIDTRANS_SERVER_KEY && MIDTRANS_CLIENT_KEY) {
    snapClient = new midtransClient.Snap({
      isProduction: MIDTRANS_IS_PRODUCTION,
      serverKey: MIDTRANS_SERVER_KEY,
      clientKey: MIDTRANS_CLIENT_KEY
    });
    console.log('💳 Midtrans Snap client initialized');
  }
  return snapClient;
};

/**
 * Get Midtrans Core API client (singleton)
 * @returns {Object} Midtrans Core API client
 */
const getCoreApiClient = () => {
  if (!coreApiClient && MIDTRANS_SERVER_KEY && MIDTRANS_CLIENT_KEY) {
    coreApiClient = new midtransClient.CoreApi({
      isProduction: MIDTRANS_IS_PRODUCTION,
      serverKey: MIDTRANS_SERVER_KEY,
      clientKey: MIDTRANS_CLIENT_KEY
    });
    console.log('💳 Midtrans Core API client initialized');
  }
  return coreApiClient;
};

// =============================
// MIDTRANS UTILITIES
// =============================

/**
 * Check if Midtrans is properly configured
 * @returns {boolean} True if Midtrans is configured
 */
const isMidtransConfigured = () => {
  return !!(MIDTRANS_SERVER_KEY && MIDTRANS_CLIENT_KEY);
};

/**
 * Get Midtrans environment info
 * @returns {Object} Environment information
 */
const getMidtransEnvironment = () => {
  return {
    isProduction: MIDTRANS_IS_PRODUCTION,
    hasServerKey: !!MIDTRANS_SERVER_KEY,
    hasClientKey: !!MIDTRANS_CLIENT_KEY,
    isConfigured: isMidtransConfigured(),
  };
};

/**
 * Create transaction parameters for Midtrans
 * @param {Object} options - Transaction options
 * @param {string} options.orderId - Unique order ID
 * @param {number} options.amount - Transaction amount
 * @param {Object} options.customerDetails - Customer information
 * @param {Array} options.itemDetails - Item details
 * @param {Object} options.customField - Custom fields
 * @returns {Object} Midtrans transaction parameters
 */
const createTransactionParams = ({ 
  orderId, 
  amount, 
  customerDetails, 
  itemDetails = [], 
  customField = {} 
}) => {
  return {
    transaction_details: {
      order_id: orderId,
      gross_amount: amount
    },
    customer_details: {
      first_name: customerDetails.firstName || '',
      last_name: customerDetails.lastName || '',
      email: customerDetails.email || '',
      phone: customerDetails.phone || '',
    },
    item_details: itemDetails,
    custom_field1: customField.eventId || '',
    custom_field2: customField.userId || '',
    custom_field3: customField.bookingType || '',
    callbacks: {
      finish: process.env.MIDTRANS_FINISH_URL || `${process.env.API_BASE_URL || 'https://api.dancesignal.com'}/webhooks/payment/success`,
      error: process.env.MIDTRANS_ERROR_URL || `${process.env.API_BASE_URL || 'https://api.dancesignal.com'}/webhooks/payment/error`,
      pending: process.env.MIDTRANS_PENDING_URL || `${process.env.API_BASE_URL || 'https://api.dancesignal.com'}/webhooks/payment/pending`,
    }
  };
};

/**
 * Create standard item details for Midtrans
 * @param {Object} options - Item options
 * @param {string} options.name - Item name
 * @param {number} options.price - Item price
 * @param {number} options.quantity - Item quantity
 * @param {string} options.category - Item category
 * @returns {Array} Midtrans item details array
 */
const createItemDetails = ({ name, price, quantity = 1, category = 'event_ticket' }) => {
  return [{
    id: `item-${Date.now()}`,
    price: price,
    quantity: quantity,
    name: name,
    category: category,
    merchant_name: 'DanceSignal'
  }];
};

/**
 * Parse Midtrans notification/callback
 * @param {Object} notification - Midtrans notification object
 * @returns {Object} Parsed notification data
 */
const parseNotification = (notification) => {
  return {
    transactionId: notification.transaction_id,
    orderId: notification.order_id,
    paymentType: notification.payment_type,
    transactionStatus: notification.transaction_status,
    fraudStatus: notification.fraud_status,
    grossAmount: parseFloat(notification.gross_amount),
    signature: notification.signature_key,
    eventId: notification.custom_field1,
    userId: notification.custom_field2,
    bookingType: notification.custom_field3,
  };
};

module.exports = {
  // Client getters
  getSnapClient,
  getCoreApiClient,
  
  // Configuration
  isMidtransConfigured,
  getMidtransEnvironment,
  
  // Utilities
  createTransactionParams,
  createItemDetails,
  parseNotification,
  
  // Constants
  MIDTRANS_IS_PRODUCTION,
};