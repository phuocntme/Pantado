import { db } from "ponder:api";
import schema from "ponder:schema";
import { Hono } from "hono";
import { client, desc, eq, graphql } from "ponder";

/**
 * Indexer HTTP API (internal). `/sql/*` and `/graphql` for services; `/levels/:index/latest` for
 * scripts/check-level.ts. Ponder itself serves `/health`, `/ready` and `/metrics`.
 */
const app = new Hono();
app.use("/sql/*", client({ db, schema }));
app.use("/graphql", graphql({ db, schema }));

app.get("/levels/:index/latest", async (c) => {
  const index = c.req.param("index").toLowerCase() as `0x${string}`;
  const rows = await db
    .select()
    .from(schema.indexLevels)
    .where(eq(schema.indexLevels.index, index))
    .orderBy(desc(schema.indexLevels.block))
    .limit(1);
  const r = rows[0];
  if (!r) return c.json({ error: "Not found" }, 404);
  return c.json({ index, block: r.block.toString(), level: r.level.toString(), value: r.value.toString(), supply: r.supply.toString() });
});

app.get("/indexes", async (c) => {
  const rows = await db.select({ id: schema.indexes.id, ticker: schema.indexes.ticker }).from(schema.indexes);
  return c.json(rows);
});

export default app;
