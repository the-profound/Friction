import pg from "pg";
const { Client } = pg;
let dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl.startsWith("postgresql://") && !dbUrl.startsWith("postgres://")) {
  dbUrl = "postgresql://" + dbUrl;
}
const client = new Client({ connectionString: dbUrl });
await client.connect();

const res2 = await client.query(`
  SELECT delivery_slot,
         count(distinct recipient_id) AS notified_recipients,
         min(notified_at) AS first_claim_at,
         max(notified_at) AS last_claim_at
  FROM letter_arrival_notifications
  WHERE delivery_slot >= now() - interval '10 days'
  GROUP BY delivery_slot
  ORDER BY delivery_slot
`);
console.log("Notification claims (last 10 days):");
console.table(res2.rows);

const now = await client.query("select now()");
console.log("DB now():", now.rows[0].now);

await client.end();
