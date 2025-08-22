const { MIDTRANS_SERVER_KEY, MIDTRANS_IS_PRODUCTION } = require('../../lib/midtrans-config');
const { AppError } = require('../../utils/index');

/**
 * PaymentVerificationService - Service for verifying payment status with Midtrans
 * Handles direct API calls to Midtrans to check payment status
 */
class PaymentVerificationService {
  constructor() {
    this.midtransApiUrl = MIDTRANS_IS_PRODUCTION 
      ? 'https://api.midtrans.com' 
      : 'https://api.sandbox.midtrans.com';
      
    this.authString = Buffer.from(`${MIDTRANS_SERVER_KEY}:`).toString('base64');
  }

  /**
   * ✅ Check payment status directly from Midtrans API 
   * @param {string} orderId - Order/booking code to check
   * @returns {Object} Midtrans transaction status response
   */
  async checkPaymentStatusViaAPI(orderId) {
    try {
      console.log(`🔍 PaymentVerificationService: Checking status for ${orderId}`);
      
      const url = `${this.midtransApiUrl}/v2/${orderId}/status`;
      
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'Authorization': `Basic ${this.authString}`
        }
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`❌ Midtrans API error ${response.status}:`, errorText);
        
        if (response.status === 404) {
          throw new AppError(`Payment not found: ${orderId}`, 404);
        }
        
        throw new AppError(`Midtrans API error: ${response.status}`, response.status);
      }

      const result = await response.json();
      
      console.log(`✅ PaymentVerificationService: Status for ${orderId}:`, {
        transaction_status: result.transaction_status,
        payment_type: result.payment_type,
        gross_amount: result.gross_amount
      });

      return result;
      
    } catch (error) {
      console.error(`❌ PaymentVerificationService: Error checking ${orderId}:`, error);
      throw error;
    }
  }

  /**
   * ✅ Check if payment status indicates success
   * Based on Midtrans documentation: capture and settlement are success statuses
   * @param {Object} midtransStatus - Response from Midtrans status API
   * @returns {boolean} True if payment is successful
   */
  static isPaymentSuccessful(midtransStatus) {
    if (!midtransStatus || !midtransStatus.transaction_status) {
      return false;
    }

    const successStatuses = ['capture', 'settlement'];
    const status = midtransStatus.transaction_status.toLowerCase();
    
    const isSuccessful = successStatuses.includes(status);
    
    console.log(`🔍 isPaymentSuccessful: ${status} -> ${isSuccessful}`);
    
    return isSuccessful;
  }

  /**
   * ✅ Check if payment status indicates failure  
   * @param {Object} midtransStatus - Response from Midtrans status API
   * @returns {boolean} True if payment failed
   */
  static isPaymentFailed(midtransStatus) {
    if (!midtransStatus || !midtransStatus.transaction_status) {
      return false;
    }

    const failedStatuses = ['deny', 'cancel', 'expire', 'failure'];
    const status = midtransStatus.transaction_status.toLowerCase();
    
    return failedStatuses.includes(status);
  }

  /**
   * ✅ Check if payment is still pending
   * @param {Object} midtransStatus - Response from Midtrans status API  
   * @returns {boolean} True if payment is pending
   */
  static isPaymentPending(midtransStatus) {
    if (!midtransStatus || !midtransStatus.transaction_status) {
      return false;
    }

    const pendingStatuses = ['pending', 'authorize'];
    const status = midtransStatus.transaction_status.toLowerCase();
    
    return pendingStatuses.includes(status);
  }

  /**
   * ✅ Placeholder for mass payment recovery - not implemented yet
   * @returns {Object} Recovery results
   */
  async recoverMissedPayments() {
    console.log('🔍 PaymentVerificationService: recoverMissedPayments called - not implemented');
    return {
      success: true,
      message: 'Mass recovery not implemented yet',
      recovered: 0
    };
  }

  /**
   * ✅ Placeholder for guestlist payment verification - not implemented yet  
   * @param {string} orderId - Order ID to verify
   * @returns {Object} Verification results
   */
  async verifyGuestlistPaymentStatus(orderId) {
    console.log(`🔍 PaymentVerificationService: verifyGuestlistPaymentStatus for ${orderId} - not implemented`);
    return {
      success: false,
      message: 'Guestlist verification not implemented yet',
      guestListEntry: null,
      paymentStatus: 'UNKNOWN',
      reason: 'Method not implemented'
    };
  }
}

module.exports = PaymentVerificationService;