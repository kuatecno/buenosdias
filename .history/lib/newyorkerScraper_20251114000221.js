'use strict';

const { XMLParser } = require('fast-xml-parser');
const cheerio = require('cheerio');

const SITEMAP_URLS = [
  'https://www.newyorker.com/sitemap-archive-5.xml'
];

const DEFAULT_LIMIT = 50;

async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'mejoresnoticias-scraper/1.0 (+https://example.com)',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    }
  });

  if (!res.ok) {
    throw new Error(`Request failed for ${url} with status ${res.status}`);
  }

  return await res.text();
}

function parseSitemapXml(xml) {
  const parser = new XMLParser({ ignoreAttributes: false });
  const data = parser.parse(xml);

  if (!data) return [];

  const urlset = data.urlset || data.urlSet;
  if (!urlset || !urlset.url) return [];

  const items = Array.isArray(urlset.url) ? urlset.url : [urlset.url];

  return items
    .map((u) => {
      const loc = u.loc;
      const lastmod = u.lastmod || u.lastModified || null;
      return loc ? { loc, lastmod } : null;
    })
    .filter(Boolean);
}

async function collectNewsUrls() {
  const all = [];

  for (const sitemapUrl of SITEMAP_URLS) {
    try {
      const xml = await fetchText(sitemapUrl);
      const entries = parseSitemapXml(xml);
      for (const e of entries) {
        if (e.loc && e.loc.includes('/news/')) {
          all.push(e);
        }
      }
    } catch (err) {
      console.error(`Failed to process sitemap ${sitemapUrl}:`, err.message);
    }
  }

  const dedupedMap = new Map();
  for (const e of all) {
    const existing = dedupedMap.get(e.loc);
    if (!existing) {
      dedupedMap.set(e.loc, e);
    } else if (!existing.lastmod && e.lastmod) {
      dedupedMap.set(e.loc, e);
    }
  }

  return Array.from(dedupedMap.values());
}

function pickJsonLdArticle(json) {
  if (!json) return null;

  if (Array.isArray(json)) {
    for (const item of json) {
      const picked = pickJsonLdArticle(item);
      if (picked) return picked;
    }
    return null;
  }

  if (typeof json === 'object') {
    if (json['@type'] === 'NewsArticle' || json['@type'] === 'Article') {
      return json;
    }

    const graph = json['@graph'];
    if (Array.isArray(graph)) {
      for (const item of graph) {
        const picked = pickJsonLdArticle(item);
        if (picked) return picked;
      }
    }
  }

  return null;
}

function extractFromJsonLd(jsonLd) {
  if (!jsonLd || typeof jsonLd !== 'object') return {};

  const title = jsonLd.headline || jsonLd.name || null;
  const description = jsonLd.description || null;
  const image =
    (Array.isArray(jsonLd.image) ? jsonLd.image[0] : jsonLd.image) || null;
  const datePublished = jsonLd.datePublished || jsonLd.dateCreated || null;

  return { title, description, imageUrl: image, publishedAt: datePublished };
}

function extractFromMeta($) {
  const title =
    $('meta[property="og:title"]').attr('content') ||
    $('meta[name="twitter:title"]').attr('content') ||
    $('title').text() ||
    null;

  const description =
    $('meta[property="og:description"]').attr('content') ||
    $('meta[name="description"]').attr('content') ||
    null;

  const imageUrl =
    $('meta[property="og:image"]').attr('content') ||
    $('meta[name="twitter:image"]').attr('content') ||
    null;

  return { title, description, imageUrl, publishedAt: null };
}

async function scrapeArticle(url) {
  const html = await fetchText(url);
  const $ = cheerio.load(html);

  let jsonLdRaw = null;
  let jsonLdArticle = null;

  $('script[type="application/ld+json"]').each((_, el) => {
    const text = $(el).contents().text().trim();
    if (!text) return;

    try {
      const parsed = JSON.parse(text);
      const candidate = pickJsonLdArticle(parsed);
      if (candidate && !jsonLdArticle) {
        jsonLdArticle = candidate;
        jsonLdRaw = text;
      }
    } catch (err) {
      // ignore JSON parse errors on non-article LD
    }
  });

  let fromLd = extractFromJsonLd(jsonLdArticle);
  const fromMeta = extractFromMeta($);

  const title = fromLd.title || fromMeta.title;
  const description = fromLd.description || fromMeta.description;
  const imageUrl = fromLd.imageUrl || fromMeta.imageUrl;
  const publishedAt = fromLd.publishedAt || fromMeta.publishedAt;

  return {
    url,
    title,
    description,
    imageUrl,
    publishedAt: publishedAt ? new Date(publishedAt) : null,
    rawJsonLd: jsonLdRaw
  };
}

async function scrapeLatestNews(options = {}) {
  const limit = options.limit || DEFAULT_LIMIT;

  const entries = await collectNewsUrls();

  entries.sort((a, b) => {
    if (a.lastmod && b.lastmod) {
      return new Date(b.lastmod) - new Date(a.lastmod);
    }
    if (a.lastmod) return -1;
    if (b.lastmod) return 1;
    return 0;
  });

  const selected = entries.slice(0, limit);

  const results = [];
  for (const entry of selected) {
    try {
      const article = await scrapeArticle(entry.loc);
      results.push(article);
    } catch (err) {
      console.error(`Failed to scrape article ${entry.loc}:`, err.message);
    }
  }

  return results;
}

module.exports = {
  scrapeLatestNews
};
