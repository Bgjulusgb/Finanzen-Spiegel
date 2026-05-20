/**
 * Wrapper for sentiment analysis that handles ESM/CJS compatibility
 * Fixes issues with 'natural' and 'afinn-165' ESM module conflicts
 */

'use strict';

let sentimentAnalyzer;

/**
 * Initialize sentiment analyzer using dynamic import
 * This works around the ESM/CJS compatibility issue in the 'natural' library
 */
async function initializeSentimentAnalyzer() {
  if (sentimentAnalyzer) return sentimentAnalyzer;

  try {
    // Dynamic import to load AFINN-165 as ESM
    const { default: Sentiment } = await import('sentiment');
    sentimentAnalyzer = new Sentiment();
    return sentimentAnalyzer;
  } catch (error) {
    console.warn('Failed to load sentiment module with dynamic import:', error.message);
    // Fallback: return a mock analyzer that returns 0
    return {
      analyze: () => ({ score: 0, comparative: 0, words: [], positive: [], negative: [] }),
    };
  }
}

/**
 * Analyze sentiment of text
 * @param {string} text - Text to analyze
 * @returns {Promise<Object>} Sentiment analysis result
 */
async function analyzeSentiment(text) {
  if (!text || typeof text !== 'string') {
    return { score: 0, comparative: 0, words: [], positive: [], negative: [] };
  }

  try {
    const analyzer = await initializeSentimentAnalyzer();
    return analyzer.analyze(text);
  } catch (error) {
    console.error('Error analyzing sentiment:', error);
    return { score: 0, comparative: 0, words: [], positive: [], negative: [] };
  }
}

/**
 * Classify sentiment into categories
 * @param {number} score - Sentiment score
 * @returns {string} Sentiment category (positive, neutral, negative)
 */
function classifySentiment(score) {
  if (score > 0.05) return 'positive';
  if (score < -0.05) return 'negative';
  return 'neutral';
}

module.exports = {
  initializeSentimentAnalyzer,
  analyzeSentiment,
  classifySentiment,
};
