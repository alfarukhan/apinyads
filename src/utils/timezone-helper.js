/**
 * Timezone Helper for Indonesia (GMT+7)
 * Ensures all date operations use consistent Jakarta timezone
 */

const JAKARTA_TIMEZONE = 'Asia/Jakarta';
const GMT_OFFSET = '+07:00';

/**
 * Get current date/time in Jakarta timezone
 * @returns {Date} Current date in Jakarta timezone
 */
function getJakartaNow() {
  return new Date(new Date().toLocaleString("en-US", { timeZone: JAKARTA_TIMEZONE }));
}

/**
 * Get today's date at 00:00:00 in Jakarta timezone
 * @returns {Date} Today's date at midnight Jakarta time
 */
function getJakartaToday() {
  const now = getJakartaNow();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/**
 * Get tomorrow's date at 00:00:00 in Jakarta timezone  
 * @returns {Date} Tomorrow's date at midnight Jakarta time
 */
function getJakartaTomorrow() {
  const today = getJakartaToday();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return tomorrow;
}

/**
 * Convert any date to Jakarta timezone
 * @param {Date|string} date - Date to convert
 * @returns {Date} Date converted to Jakarta timezone
 */
function toJakartaTime(date) {
  const inputDate = new Date(date);
  return new Date(inputDate.toLocaleString("en-US", { timeZone: JAKARTA_TIMEZONE }));
}

/**
 * Create a date from string/components in Jakarta timezone at midnight
 * @param {string|Date} input - Date string or Date object
 * @returns {Date} Date at midnight Jakarta timezone
 */
function createJakartaDate(input) {
  // If input is 'YYYY-MM-DD', construct UTC midnight for that date to avoid TZ shifts in DATE columns
  if (typeof input === 'string') {
    const dateOnlyMatch = input.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (dateOnlyMatch) {
      const year = parseInt(dateOnlyMatch[1], 10);
      const month = parseInt(dateOnlyMatch[2], 10) - 1; // zero-based
      const day = parseInt(dateOnlyMatch[3], 10);
      return new Date(Date.UTC(year, month, day));
    }
  }
  const inputDate = new Date(input);
  const jakartaDate = toJakartaTime(inputDate);
  // Construct UTC midnight using Jakarta date components to keep calendar date stable in DB DATE columns
  return new Date(Date.UTC(jakartaDate.getFullYear(), jakartaDate.getMonth(), jakartaDate.getDate()));
}

/**
 * Format date for logging with Jakarta timezone
 * @param {Date} date - Date to format
 * @returns {string} Formatted date string with timezone
 */
function formatJakartaDate(date) {
  const jakartaDate = toJakartaTime(date);
  return jakartaDate.toISOString().replace('Z', GMT_OFFSET);
}

/**
 * Get date range for a specific date in Jakarta timezone
 * @param {Date|string} date - Target date
 * @returns {Object} Object with start and end of day in Jakarta timezone
 */
function getJakartaDateRange(date) {
  const startOfDayUtc = date ? createJakartaDate(date) : getJakartaTodayUTCDate();
  const endOfDayUtc = new Date(startOfDayUtc);
  endOfDayUtc.setUTCDate(endOfDayUtc.getUTCDate() + 1);
  return { start: startOfDayUtc, end: endOfDayUtc };
}

/**
 * Check if two dates are the same day in Jakarta timezone
 * @param {Date} date1 - First date
 * @param {Date} date2 - Second date  
 * @returns {boolean} True if same day in Jakarta timezone
 */
function isSameDayJakarta(date1, date2) {
  const jakarta1 = toJakartaTime(date1);
  const jakarta2 = toJakartaTime(date2);
  
  return jakarta1.getFullYear() === jakarta2.getFullYear() &&
         jakarta1.getMonth() === jakarta2.getMonth() &&
         jakarta1.getDate() === jakarta2.getDate();
}

/**
 * Add days to a date while maintaining Jakarta timezone
 * @param {Date} date - Base date
 * @param {number} days - Number of days to add
 * @returns {Date} New date with days added in Jakarta timezone
 */
function addDaysJakarta(date, days) {
  const jakartaDate = toJakartaTime(date);
  const result = new Date(jakartaDate);
  result.setDate(result.getDate() + days);
  return result;
}

/**
 * Get UTC date representing Jakarta today's midnight (00:00:00Z for Jakarta calendar date)
 */
function getJakartaTodayUTCDate() {
  const now = getJakartaNow();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

/**
 * Get UTC date representing Jakarta tomorrow's midnight (00:00:00Z for next Jakarta date)
 */
function getJakartaTomorrowUTCDate() {
  const todayUtc = getJakartaTodayUTCDate();
  const tomorrowUtc = new Date(todayUtc);
  tomorrowUtc.setUTCDate(tomorrowUtc.getUTCDate() + 1);
  return tomorrowUtc;
}

/**
 * Get Jakarta timezone info
 * @returns {Object} Timezone information
 */
function getTimezoneInfo() {
  return {
    timezone: JAKARTA_TIMEZONE,
    offset: GMT_OFFSET,
    offsetMinutes: 420, // GMT+7 = 420 minutes
    name: 'Western Indonesia Time (WIB)'
  };
}

/**
 * Compare dates for daily drop matching - checks if database date matches target date in Jakarta timezone
 * @param {Date} dbDate - Date from database
 * @param {Date} targetDate - Target date (today)
 * @returns {boolean} True if dates match in Jakarta timezone
 */
function isDateMatchJakarta(dbDate, targetDate) {
  const dbJakarta = toJakartaTime(dbDate);
  const targetJakarta = toJakartaTime(targetDate);
  
  return dbJakarta.getFullYear() === targetJakarta.getFullYear() &&
         dbJakarta.getMonth() === targetJakarta.getMonth() &&
         dbJakarta.getDate() === targetJakarta.getDate();
}

module.exports = {
  // Core functions
  getJakartaNow,
  getJakartaToday,
  getJakartaTomorrow,
  getJakartaTodayUTCDate,
  getJakartaTomorrowUTCDate,
  toJakartaTime,
  createJakartaDate,
  
  // Utility functions
  formatJakartaDate,
  getJakartaDateRange,
  isSameDayJakarta,
  addDaysJakarta,
  isDateMatchJakarta,
  
  // Info
  getTimezoneInfo,
  
  // Constants
  JAKARTA_TIMEZONE,
  GMT_OFFSET
};