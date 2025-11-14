# New Yorker Scraper API (Vercel-ready)

This project exposes a Vercel-compatible serverless API to scrape recent New Yorker news articles using **sitemaps + JSON-LD** and store them in **Postgres**.

## Overview

- Uses `https://www.newyorker.com/sitemap-archive-5.xml` to discover article URLs.
- Filters URLs containing `/news/`.
- For each article page:
  - Fetches HTML via `fetch`.
  - Extracts structured data from `application/ld+json` (schema.org).
  - Falls back to OpenGraph / meta tags.
- Upserts results into a Postgres table `newyorker_articles`.

## Files

- `api/scrape-newyorker.js` – Vercel serverless function entrypoint.
- `lib/newyorkerScraper.js` – sitemap + article scraping logic.
- `lib/db.js` – Postgres connection and upsert helpers.
- `package.json` – dependencies and scripts.

## Environment variables

Set one of the following in your environment (Vercel dashboard or local `.env`):

- `DATABASE_URL` – full Postgres connection string (preferred), or
- `POSTGRES_URL` – alternative name if you already use it.

Example connection string:

```text
postgres://USER:PASSWORD@HOST:PORT/DBNAME
```

## Database schema

On first invocation, the API will ensure the table exists:

```sql
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
```

## Running locally

1. Install dependencies:

   ```bash
   npm install
   ```

2. Ensure `DATABASE_URL` (or `POSTGRES_URL`) is set in your shell.

3. Run the function locally (for a simple smoke test) with Node:

   ```bash
   node api/scrape-newyorker.js
   ```

   For proper local API behavior, deploy via Vercel CLI or integrate into a Next.js app.

## Deploying on Vercel

1. Push this project to a Git repo (GitHub, GitLab, etc.).
2. Create a new Vercel project and link the repo.
3. In Vercel project settings, set `DATABASE_URL` to your Postgres connection string.
4. Deploy.

Your scraping endpoint will be available at:

```text
https://<your-vercel-project>.vercel.app/api/scrape-newyorker
```

You can optionally limit the number of articles scraped (default: 50):

```text
https://<your-vercel-project>.vercel.app/api/scrape-newyorker?limit=20
```

## Notes

- This scraper relies on New Yorker sitemaps and JSON-LD, which is much less brittle than CSS selectors.
- Always respect New Yorker\'s Terms of Use and avoid aggressive scraping (Vercel functions already batch calls, but you can add further throttling if needed).
