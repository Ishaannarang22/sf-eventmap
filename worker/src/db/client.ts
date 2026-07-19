import { neon } from '@neondatabase/serverless';

// The Neon serverless driver speaks Postgres over HTTP, so the same code runs
// locally (Node) and on Cloudflare Workers. `sql` is a tagged-template client.
const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error('DATABASE_URL is not set. Copy worker/.env.example to .env and fill it in.');
}

export const sql = neon(url);
