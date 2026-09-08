import pg from "pg";
const { Client } = pg;
let dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl.startsWith("postgresql://") && !dbUrl.startsWith("postgres://")) {
  dbUrl = "postgresql://" + dbUrl;
}
const client = new Client({ connectionString: dbUrl });
await client.connect();

// inspect inbox columns
const cols = await client.query(`
  SELECT column_name FROM information_schema.columns WHERE table_name = 'inbox'
`);
console.log("inbox columns:", cols.rows.map(r => r.column_name));

const todaySlot = new Date("2026-09-07T21:00:00.000Z");
const rows = await client.query(`
  SELECT id, recipient_id, visible_at, created_at
  FROM inbox
  WHERE visible_at = $1
  ORDER BY created_at
`, [todaySlot]);
console.table(rows.rows.map(r => ({ id: r.id, recipient_id: r.recipient_id.slice(0,8), visible_at: r.visible_at, created_at: r.created_at })));

await client.end();
