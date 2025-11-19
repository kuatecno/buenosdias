'use strict';

require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const path = require('path');

const app = express();
const PORT = 3000;

// Database connection
const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;

if (!connectionString) {
  console.error('DATABASE_URL or POSTGRES_URL is not set');
  process.exit(1);
}

const pool = new Pool({ connectionString });

// Middleware
app.use(express.json());
app.use(express.static('.'));

// Test endpoint for debugging
app.get('/api/test', async (req, res) => {
  try {
    console.log('Testing database connection...');
    const { rows } = await pool.query('SELECT COUNT(*) as count FROM articles');
    console.log('Database test result:', rows);
    res.json({ success: true, count: rows[0].count });
  } catch (err) {
    console.error('Database test error:', err);
    res.status(500).json({ error: err.message });
  }
});

// API Routes
app.get('/api/articles', async (req, res) => {
  try {
    const { page = 1, limit = 10, search = '', withBody = '' } = req.query;
    const offset = (page - 1) * limit;
    
    let whereClause = 'WHERE 1=1';
    let queryParams = [];
    let paramIndex = 1;
    
    if (search) {
      whereClause += ` AND (title ILIKE $${paramIndex} OR description ILIKE $${paramIndex})`;
      queryParams.push(`%${search}%`);
      paramIndex++;
    }
    
    if (withBody === 'true') {
      whereClause += ` AND body_available = true`;
    } else if (withBody === 'false') {
      whereClause += ` AND body_available = false`;
    }
    
    const query = `
      SELECT 
        id,
        title,
        description,
        image_url,
        body_available,
        published_at,
        scraped_at,
        url
      FROM articles 
      ${whereClause}
      ORDER BY published_at DESC, scraped_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;
    
    queryParams.push(parseInt(limit), parseInt(offset));
    
    console.log('=== DEBUG INFO ===');
    console.log('Page:', page, 'Limit:', limit, 'Offset:', offset);
    console.log('Where Clause:', whereClause);
    console.log('Query:', query);
    console.log('Query Parameters:', queryParams);
    console.log('Parameter types:', queryParams.map(p => typeof p));
    console.log('==================');
    
    const { rows } = await pool.query(query, queryParams);
    
    // Get total count for pagination
    const countQuery = `
      SELECT COUNT(*) as total
      FROM articles 
      ${whereClause}
    `;
    
    // For count query, only use WHERE clause parameters (exclude limit/offset)
    const countParams = queryParams.slice(0, -2);
    
    console.log('Count Query:', countQuery);
    console.log('Count Params:', countParams);
    const { rows: countRows } = await pool.query(countQuery, countParams);
    const total = parseInt(countRows[0].total);
    
    res.json({
      articles: rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
    
  } catch (err) {
    console.error('Error fetching articles:', err);
    res.status(500).json({ error: 'Failed to fetch articles' });
  }
});

app.get('/api/articles/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const query = `
      SELECT * FROM articles 
      WHERE id = $1
    `;
    
    const { rows } = await pool.query(query, [id]);
    
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Article not found' });
    }
    
    res.json(rows[0]);
    
  } catch (err) {
    console.error('Error fetching article:', err);
    res.status(500).json({ error: 'Failed to fetch article' });
  }
});

app.get('/api/stats', async (req, res) => {
  try {
    const query = `
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN body_available = true THEN 1 END) as with_body,
        COUNT(CASE WHEN body_available = false THEN 1 END) as without_body
      FROM articles
    `;
    
    const { rows } = await pool.query(query);
    res.json(rows[0]);
    
  } catch (err) {
    console.error('Error fetching stats:', err);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// Admin API endpoints
app.delete('/api/admin/articles/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const query = 'DELETE FROM articles WHERE id = $1';
    await pool.query(query, [id]);
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting article:', err);
    res.status(500).json({ error: 'Failed to delete article' });
  }
});

app.delete('/api/admin/articles/delete', async (req, res) => {
  try {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids)) {
      return res.status(400).json({ error: 'Invalid article IDs' });
    }
    
    const query = 'DELETE FROM articles WHERE id = ANY($1)';
    await pool.query(query, [ids]);
    res.json({ success: true, deleted: ids.length });
  } catch (err) {
    console.error('Error deleting articles:', err);
    res.status(500).json({ error: 'Failed to delete articles' });
  }
});

app.post('/api/admin/articles/publish', async (req, res) => {
  try {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids)) {
      return res.status(400).json({ error: 'Invalid article IDs' });
    }
    
    const query = 'UPDATE articles SET published = true WHERE id = ANY($1)';
    await pool.query(query, [ids]);
    res.json({ success: true, published: ids.length });
  } catch (err) {
    console.error('Error publishing articles:', err);
    res.status(500).json({ error: 'Failed to publish articles' });
  }
});

app.post('/api/admin/articles/unpublish', async (req, res) => {
  try {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids)) {
      return res.status(400).json({ error: 'Invalid article IDs' });
    }
    
    const query = 'UPDATE articles SET published = false WHERE id = ANY($1)';
    await pool.query(query, [ids]);
    res.json({ success: true, unpublished: ids.length });
  } catch (err) {
    console.error('Error unpublishing articles:', err);
    res.status(500).json({ error: 'Failed to unpublish articles' });
  }
});

app.post('/api/admin/scrape', async (req, res) => {
  try {
    // Trigger manual scrape
    const { spawn } = require('child_process');
    // Set LIMIT=50 environment variable for the scrape process
    // Use node directly instead of npm to avoid PATH issues
    const scrapeProcess = spawn(process.execPath, ['api/scrape-all.js'], {
      cwd: __dirname,
      detached: true,
      env: { ...process.env, LIMIT: '50' },
      stdio: 'ignore'
    });
    
    scrapeProcess.unref();
    res.json({ success: true, message: 'Scraping started in background' });
  } catch (err) {
    console.error('Error triggering scrape:', err);
    res.status(500).json({ error: 'Failed to start scraping: ' + err.message });
  }
});

app.post('/api/admin/ai-process', async (req, res) => {
  try {
    // Trigger AI processing
    const { spawn } = require('child_process');
    const aiProcess = spawn(process.execPath, ['ai/select-and-generate.js'], {
      cwd: __dirname,
      detached: true,
      stdio: 'ignore'
    });
    
    aiProcess.unref();
    res.json({ success: true, message: 'AI processing started in background' });
  } catch (err) {
    console.error('Error triggering AI processing:', err);
    res.status(500).json({ error: 'Failed to start AI processing' });
  }
});

app.get('/api/admin/status', async (req, res) => {
  try {
    // Get scraping status
    const query = `
      SELECT 
        MAX(scraped_at) as last_scrape,
        COUNT(*) as total_articles
      FROM articles
    `;
    
    const { rows } = await pool.query(query);
    const lastScrape = rows[0].last_scrape;
    
    // Calculate next scrape (6 hours from last scrape)
    let nextScrape = 'Unknown';
    if (lastScrape) {
      const next = new Date(lastScrape.getTime() + 6 * 60 * 60 * 1000);
      nextScrape = next.toLocaleString();
    }
    
    res.json({
      lastScrape: lastScrape ? new Date(lastScrape).toLocaleString() : 'Never',
      nextScrape,
      totalArticles: rows[0].total_articles
    });
  } catch (err) {
    console.error('Error getting status:', err);
    res.status(500).json({ error: 'Failed to get status' });
  }
});

app.post('/api/admin/cleanup', async (req, res) => {
  try {
    const query = 'DELETE FROM articles WHERE scraped_at < NOW() - INTERVAL \'30 days\'';
    const { rows } = await pool.query(query);
    res.json({ success: true, deleted: rows.length });
  } catch (err) {
    console.error('Error cleaning up:', err);
    res.status(500).json({ error: 'Failed to cleanup old articles' });
  }
});

app.get('/api/admin/export', async (req, res) => {
  try {
    const query = 'SELECT * FROM articles ORDER BY scraped_at DESC';
    const { rows } = await pool.query(query);
    
    const exportData = {
      exported_at: new Date().toISOString(),
      total_articles: rows.length,
      articles: rows
    };
    
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="articles-export-${new Date().toISOString().split('T')[0]}.json"`);
    res.json(exportData);
  } catch (err) {
    console.error('Error exporting:', err);
    res.status(500).json({ error: 'Failed to export data' });
  }
});

app.get('/api/admin/stats', async (req, res) => {
  try {
    const query = `
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN published = true THEN 1 END) as published,
        COUNT(CASE WHEN body_available = true THEN 1 END) as with_body,
        COUNT(DISTINCT source) as sources,
        MIN(published_at) as oldest,
        MAX(published_at) as newest
      FROM articles
    `;
    
    const { rows } = await pool.query(query);
    const stats = rows[0];
    
    res.json({
      total: stats.total,
      published: stats.published,
      withBody: stats.with_body,
      sources: stats.sources,
      oldest: stats.oldest ? new Date(stats.oldest).toLocaleDateString() : 'Unknown',
      newest: stats.newest ? new Date(stats.newest).toLocaleDateString() : 'Unknown'
    });
  } catch (err) {
    console.error('Error getting stats:', err);
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

// AI Content API endpoints
app.get('/api/ai/content', async (req, res) => {
  try {
    const query = 'SELECT * FROM processed_content ORDER BY processed_at DESC LIMIT 1';
    const { rows } = await pool.query(query);
    
    if (rows.length > 0) {
      res.json({ content: rows[0] });
    } else {
      res.json({ content: null });
    }
  } catch (err) {
    console.error('Error getting AI content:', err);
    res.status(500).json({ error: 'Failed to get AI content' });
  }
});

app.post('/api/ai/publish', async (req, res) => {
  try {
    // Mark latest AI content as published
    const query = `
      UPDATE processed_content 
      SET published = true 
      WHERE id = (SELECT id FROM processed_content ORDER BY processed_at DESC LIMIT 1)
    `;
    await pool.query(query);
    res.json({ success: true, message: 'AI content published' });
  } catch (err) {
    console.error('Error publishing AI content:', err);
    res.status(500).json({ error: 'Failed to publish AI content' });
  }
});

app.post('/api/ai/regenerate', async (req, res) => {
  try {
    // Trigger AI regeneration
    const { spawn } = require('child_process');
    const aiProcess = spawn(process.execPath, ['ai/select-and-generate.js'], {
      cwd: __dirname,
      detached: true,
      stdio: 'ignore'
    });
    
    aiProcess.unref();
    res.json({ success: true, message: 'AI content regeneration started' });
  } catch (err) {
    console.error('Error regenerating AI content:', err);
    res.status(500).json({ error: 'Failed to regenerate AI content' });
  }
});

app.post('/api/ai/config', async (req, res) => {
  try {
    const config = req.body;
    
    // Store AI configuration (you could create a config table or use environment variables)
    console.log('AI configuration saved:', config);
    res.json({ success: true, message: 'AI configuration saved' });
  } catch (err) {
    console.error('Error saving AI config:', err);
    res.status(500).json({ error: 'Failed to save AI configuration' });
  }
});

// Serve dashboard
app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'dashboard.html'));
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Article Dashboard running at http://localhost:${PORT}/dashboard`);
  console.log(`📊 API available at http://localhost:${PORT}/api/articles`);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🔄 Shutting down gracefully...');
  await pool.end();
  process.exit(0);
});
