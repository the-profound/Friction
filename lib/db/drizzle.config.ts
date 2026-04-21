import { defineConfig } from "drizzle-kit";
import path from "path";

let dbUrl = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;

if (!dbUrl) {
  throw new Error("SUPABASE_DB_URL or DATABASE_URL must be set");
}

if (!dbUrl.startsWith("postgresql://") && !dbUrl.startsWith("postgres://")) {
  dbUrl = "postgresql://" + dbUrl;
}

export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  dialect: "postgresql",
  dbCredentials: {
    url: dbUrl,
  },
});
