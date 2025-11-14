'use strict';

const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;

if (!connectionString) {
  console.warn(
    'DATABASE_URL or POSTGRES_URL is not set. Database operations will fail until it is configured.'
  );
}

const pool = connectionString
  ? new Pool({ connectionString })
  : null;

async function initSchema() {
  if (!pool) {
    throw new Error('DATABASE_URL or POSTGRES_URL must be set for Postgres.');
  }

  const createTableSQL = `
    CREATE TABLE IF NOT EXISTS newyorker_articles (
      id BIGSERIAL PRIMARY KEY,
      url TEXT UNIQUE NOT NULL,
      title TEXT,
      description TEXT,
      image_url TEXT,
      published_at TIMESTAMPTZ,
      scraped_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      raw_jsonld TEXT
    );
  `;

  await pool.query(createTableSQL);
}

async function upsertArticle(article) {
  if (!pool) {
    throw new Error('DATABASE_URL or POSTGRES_URL must be set for Postgres.');
  }

  const { url, title, description, imageUrl, publishedAt, rawJsonLd } = article;

  const query = `
    INSERT INTO newyorker_articles (
      url, title, description, image_url, published_at, scraped_at, raw_jsonld
    ) VALUES ($1, $2, $3, $4, $5, NOW(), $6)
    ON CONFLICT (url) DO UPDATE SET
      title = EXCLUDED.title,
      description = EXCLUDED.description,
      image_url = EXCLUDED.image_url,
      published_at = EXCLUDED.published_at,
      scraped_at = NOW(),
      raw_jsonld = EXCLUDED.raw_jsonld
    RETURNING *;
  `;

  const values = [
    url,
    title || null,
    description || null,
    imageUrl || null,
    publishedAt || null,
    rawJsonLd || null
  ];

  const { rows } = await pool.query(query, values);
  return rows[0];
}

async function saveArticles(articles) {
  const saved = [];
  for (const article of articles) {
    try {
      const row = await upsertArticle(article);
      saved.push(row);
    } catch (err) {
      console.error(`Failed to upsert article ${article.url}:`, err.message);
    }
  }
  return saved;
}

module.exports = {
  initSchema,
  saveArticles
};
