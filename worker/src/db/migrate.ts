// Minimal forward-only migration runner: applies any .sql file in migrations/
// that hasn't been recorded in schema_migrations yet, in filename order.
// The Neon HTTP driver runs one statement per request, so we split files into
// individual statements and run them sequentially.
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { sql } from './client.ts';

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, 'migrations');

/** Run a dynamic SQL string through the neon tagged-template client. */
function exec(statement: string) {
  const tpl = [statement] as unknown as TemplateStringsArray;
  (tpl as unknown as { raw: string[] }).raw = [statement];
  return sql(tpl);
}

function splitStatements(ddl: string): string[] {
  // Strip line comments, then split on semicolons that end a line.
  return ddl
    .replace(/^\s*--.*$/gm, '')
    .split(/;\s*$/m)
    .map((s) => s.trim())
    .filter(Boolean);
}

async function main() {
  await exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);

  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  const appliedRows = await sql`SELECT name FROM schema_migrations`;
  const applied = new Set(appliedRows.map((r) => r.name as string));

  for (const file of files) {
    if (applied.has(file)) {
      console.log(`skip  ${file}`);
      continue;
    }
    console.log(`apply ${file}`);
    for (const stmt of splitStatements(await readFile(join(dir, file), 'utf8'))) {
      await exec(stmt);
    }
    await sql`INSERT INTO schema_migrations (name) VALUES (${file})`;
  }
  console.log('migrations up to date');
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error(err); process.exit(1); });
