import pg from "pg";
const { Client } = pg;
let dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl.startsWith("postgresql://") && !dbUrl.startsWith("postgres://")) {
  dbUrl = "postgresql://" + dbUrl;
}
const client = new Client({ connectionString: dbUrl });
await client.connect();

const total = await client.query(`SELECT count(*) FROM letter_arrival_notifications`);
console.log("Total rows in letter_arrival_notifications:", total.rows[0].count);

const range = await client.query(`SELECT min(delivery_slot), max(delivery_slot), min(notified_at), max(notified_at) FROM letter_arrival_notifications`);
console.log("Range:", range.rows[0]);

// Check push tokens exist for recipients of today's slot
const todaySlot = new Date("2026-09-07T21:00:00.000Z");
const recipients = await client.query(`
  SELECT i.recipient_id, u.nickname, count(*) as cnt
  FROM inbox i
  JOIN users u ON u.id = i.recipient_id
  WHERE i.visible_at = $1
  GROUP BY i.recipient_id, u.nickname
`, [todaySlot]);
console.log("Today's slot (2026-09-08 06:00 KST) recipients:");
console.table(recipients.rows);

const pushTokenCounts = await client.query(`
  SELECT user_id, count(*) as token_count
  FROM push_tokens
  WHERE user_id = ANY($1::uuid[])
  GROUP BY user_id
`, [recipients.rows.map(r => r.recipient_id)]);
console.log("Push token counts for today's recipients:");
console.table(pushTokenCounts.rows);

await client.end();
