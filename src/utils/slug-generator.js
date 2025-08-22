/**
 * Utility for generating URL-friendly slugs from strings
 */

/**
 * Generate a URL-friendly slug from a string
 * @param {string} text - The text to convert to a slug
 * @param {number} maxLength - Maximum length of the slug (default: 100)
 * @returns {string} - URL-friendly slug
 */
function generateSlug(text, maxLength = 100) {
  if (!text || typeof text !== 'string') {
    throw new Error('Text must be a non-empty string');
  }

  return text
    .toLowerCase()
    .trim()
    // Replace spaces and special characters with hyphens
    .replace(/[^a-z0-9\s-]/g, '')
    // Replace multiple spaces/hyphens with single hyphen
    .replace(/[\s-]+/g, '-')
    // Remove leading/trailing hyphens
    .replace(/^-+|-+$/g, '')
    // Limit length
    .substring(0, maxLength)
    // Remove trailing hyphen if cut off mid-word
    .replace(/-$/, '');
}

/**
 * Generate a unique slug by appending a number if needed
 * @param {string} baseSlug - The base slug to make unique
 * @param {Function} checkExists - Async function to check if slug exists
 * @returns {Promise<string>} - Unique slug
 */
async function generateUniqueSlug(baseSlug, checkExists) {
  let slug = baseSlug;
  let counter = 1;

  // Check if base slug exists
  while (await checkExists(slug)) {
    slug = `${baseSlug}-${counter}`;
    counter++;
  }

  return slug;
}

/**
 * Generate slug from news article title
 * @param {string} title - Article title
 * @param {Function} checkExists - Function to check if slug exists in DB
 * @returns {Promise<string>} - Unique slug for the article
 */
async function generateNewsSlug(title, checkExists) {
  if (!title) {
    throw new Error('Article title is required for slug generation');
  }

  const baseSlug = generateSlug(title, 80); // Shorter for news articles
  
  if (!baseSlug) {
    throw new Error('Could not generate valid slug from title');
  }

  return await generateUniqueSlug(baseSlug, checkExists);
}

/**
 * Update existing slug to ensure uniqueness
 * @param {string} currentSlug - Current slug
 * @param {Function} checkExists - Function to check if slug exists
 * @returns {Promise<string>} - Updated unique slug
 */
async function ensureUniqueSlug(currentSlug, checkExists) {
  if (!currentSlug) {
    throw new Error('Current slug is required');
  }

  // If current slug is already unique, return it
  if (!(await checkExists(currentSlug))) {
    return currentSlug;
  }

  // Generate unique version
  return await generateUniqueSlug(currentSlug, checkExists);
}

module.exports = {
  generateSlug,
  generateUniqueSlug,
  generateNewsSlug,
  ensureUniqueSlug
};