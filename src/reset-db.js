const { query, pool } = require("./db");

async function main() {
  await query("DROP TABLE IF EXISTS schema_migrations, environments, heartbeats, screenshots, exam_events, exam_sessions CASCADE");
  console.log("Database reset.");
}

main()
  .catch(error => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => pool.end());
