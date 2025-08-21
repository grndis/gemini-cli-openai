const fs = require('fs').promises;
const path = require('path');

/**
 * Fetches and encodes an image from a URL or file path
 * @param {string} url - The URL or file path of the image
 * @returns {Promise<{mimeType: string, data: string}>} - The encoded image data
 */
async function fetchAndEncode(url) {
  try {
    // Check if it's a local file path
    if (url.startsWith('file://')) {
      const filePath = url.substring(7); // Remove 'file://' prefix
      const buffer = await fs.readFile(filePath);
      const mimeType = getMimeType(filePath);
      return {
        mimeType,
        data: buffer.toString('base64')
      };
    }
    
    // Check if it's a data URI
    if (url.startsWith('data:')) {
      const match = url.match(/^data:([^;]+);base64,(.*)$/);
      if (match) {
        return {
          mimeType: match[1],
          data: match[2]
        };
      }
      throw new Error('Invalid data URI format');
    }
    
    // Assume it's a web URL
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`);
    }
    
    const buffer = await response.arrayBuffer();
    const mimeType = response.headers.get('content-type') || 'image/jpeg';
    
    return {
      mimeType,
      data: Buffer.from(buffer).toString('base64')
    };
  } catch (error) {
    throw new Error(`Failed to fetch and encode image: ${error.message}`);
  }
}

/**
 * Determines MIME type based on file extension
 * @param {string} filePath - The file path
 * @returns {string} - The MIME type
 */
function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp'
  };
  
  return mimeTypes[ext] || 'image/jpeg';
}

module.exports = { fetchAndEncode };