'use strict';

const { scrapeLatestNews } = require('../lib/newyorkerScraper');
const { initSchema, saveArticles } = require('../lib/db');

async function runScrape(limit) {
  await initSchema();
  const articles = await scrapeLatestNews({ limit });
  const savedRows = await saveArticles(articles);

  return {
    scraped: articles.length,
    saved: savedRows.length
  };
}

async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', ['GET', 'POST']);
    res.statusCode = 405;
    return res.end(JSON.stringify({ error: 'Method not allowed' }));
  }

  try {
    const url = new URL(req.url, 'http://localhost');
    const limitParam = url.searchParams.get('limit');
    const limit = limitParam ? parseInt(limitParam, 10) || 50 : 50;

    const result = await runScrape(limit);

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        ok: true,
        scraped: result.scraped,
        saved: result.saved
      })
    );
  } catch (err) {
    console.error('Error in scrape-newyorker handler:', err);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: false, error: err.message }));
  }
}

module.exports = handler;

if (require.main === module) {
  (async () => {
    try {
      const limit = process.env.LIMIT ? parseInt(process.env.LIMIT, 10) || 50 : 50;
      const result = await runScrape(limit);
      // eslint-disable-next-line no-console
      console.log(JSON.stringify({ ok: true, ...result }, null, 2));
      process.exit(0);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Error running scrape-newyorker as CLI:', err);
      process.exit(1);
    }
  })();
}
