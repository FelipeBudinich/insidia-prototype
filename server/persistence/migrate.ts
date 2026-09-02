import pg from "pg";
import { pgOptions } from "./repository.js";
// Schema DDL is applied through a reviewed Supabase migration, separately from app recovery.
if (!process.env.DATABASE_URL)
  throw new Error("DATABASE_URL must point to Supabase");
const client = new pg.Client(pgOptions(process.env.DATABASE_URL));
await client.connect();
try {
  const result = await client.query(
    "SELECT version FROM insidia2.schema_version WHERE id=1",
  );
  if (result.rows[0]?.version !== 1)
    throw new Error("Apply the insidia2 schema migration before deployment");
  console.log("Supabase schema version 1 verified.");
} finally {
  await client.end();
}
