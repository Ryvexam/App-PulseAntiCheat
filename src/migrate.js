const fs = require("fs");
const path = require("path");
const { query, pool } = require("./db");

async function main() {
  const dir = path.join(__dirname, "..", "migrations");
  const files = fs.readdirSync(dir).filter(file => file.endsWith(".sql")).sort();

  await query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  for (const file of files) {
    const already = await query("SELECT 1 FROM schema_migrations WHERE filename = $1", [file]);
    if (already.rowCount > 0) continue;

    const sql = fs.readFileSync(path.join(dir, file), "utf8");
    await query(sql);
    await query("INSERT INTO schema_migrations(filename) VALUES ($1)", [file]);
    console.log(`Applied migration ${file}`);
  }
}

main()
  .catch(error => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => pool.end());
