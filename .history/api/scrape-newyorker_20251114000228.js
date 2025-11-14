'use strict';

const { scrapeLatestNews } = require('../lib/newyorkerScraper');
const { initSchema, saveArticles } = require('../lib/db');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const url = new URL(req.url, 'http://localhost');
    const limitParam = url.searchParams.get('limit');
    const limit = limitParam ? parseInt(limitParam, 10) || 50 : 50;

    await initSchema();
    const articles = await scrapeLatestNews({ limit });
    const savedRows = await saveArticles(articles);

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        ok: true,
        scraped: articles.length,
        saved: savedRows.length
      })
    );
  } catch (err) {
    console.error('Error in scrape-newyorker handler:', err);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: false, error: err.message }));
  }
};
