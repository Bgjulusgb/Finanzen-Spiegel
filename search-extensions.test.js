'use strict';

const { loadJson } = require('./config');
const { normalize } = require('./analyzer');

let tagsConfig = null;
function getConfig() {
  if (tagsConfig) return tagsConfig;
  try {
    tagsConfig = loadJson('tags.json');
  } catch {
    tagsConfig = { rules: [], categories: {}, category_colors: {} };
  }
  return tagsConfig;
}

function matchesAllTexts(haystack, texts) {
  return texts.every((t) => haystack.includes(normalize(t)));
}

function matchesAnyText(haystack, texts) {
  return texts.some((t) => haystack.includes(normalize(t)));
}

function autoTag(article, analysis) {
  const config = getConfig();
  const haystack = normalize(
    `${article.title || ''} ${article.fullText || article.full_text || ''} ${article.summary || ''}`
  );
  const tags = new Set();

  for (const rule of config.rules) {
    if (rule.if_sentiment) {
      const s = analysis && analysis.sentiment ? analysis.sentiment : article.sentiment;
      if (s === rule.if_sentiment) tags.add(rule.tag);
      continue;
    }
    if (rule.if_category) {
      const c = analysis && analysis.category ? analysis.category : article.category;
      if (c === rule.if_category) tags.add(rule.tag);
      continue;
    }
    if (rule.if_paywall === true && article.paywall) {
      tags.add(rule.tag);
      continue;
    }
    if (rule.match_text && Array.isArray(rule.match_text)) {
      const matched = matchesAnyText(haystack, rule.match_text);
      if (!matched) continue;
      if (rule.min_required && Array.isArray(rule.min_required)) {
        if (!matchesAllTexts(haystack, rule.min_required)) continue;
      }
      tags.add(rule.tag);
    }
  }

  return [...tags];
}

function tagCategoryColor(tag) {
  const config = getConfig();
  const parts = tag.split(':');
  const category = parts.length > 1 ? parts[0] : null;
  if (category && config.category_colors && config.category_colors[category]) {
    return config.category_colors[category];
  }
  return '#64748b';
}

function tagsByCategory(allTags) {
  const grouped = new Map();
  for (const { tag, count } of allTags) {
    const parts = tag.split(':');
    const category = parts.length > 1 ? parts[0] : 'andere';
    if (!grouped.has(category)) grouped.set(category, []);
    grouped.get(category).push({ tag, count });
  }
  return Object.fromEntries(grouped);
}

function getCategories() {
  return getConfig().categories || {};
}

function getCategoryColors() {
  return getConfig().category_colors || {};
}

module.exports = {
  autoTag,
  tagCategoryColor,
  tagsByCategory,
  getCategories,
  getCategoryColors,
};
