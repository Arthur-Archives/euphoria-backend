import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { before, after, beforeEach, describe, test } from "node:test";
import { Pool } from "pg";
import { createClient } from "redis";
import { PostgresTelemetryStore } from "../config/telemetryStore.js";
import { normalizeTelemetryPayload } from "../config/telemetryPayload.js";

const fixture = {
  schema: 1,
  instanceId: "12345678-1234-1234-1234-123456789abc",
  panel: {
    version: "1.12.0",
    phpVersion: "8.5.11",
    databaseDriver: "mysql",
    cacheDriver: "redis",
    queueDriver: "redis",
    docker: true,
  },
  resources: { users: 12, servers: 5, nodes: 2 },
};
const database = `telemetry_qa_${randomUUID().replaceAll("-", "")}`;
const adminUrl = process.env.TELEMETRY_TEST_ADMIN_URL;

describe(
  "PostgreSQL history, retention and database permissions",
  { skip: !adminUrl },
  () => {
    let admin: Pool, owner: Pool, reader: Pool, store: PostgresTelemetryStore;
    before(async () => {
      const url = new URL(adminUrl!);
      url.pathname = "/postgres";
      admin = new Pool({ connectionString: url.toString() });
      await admin.query(`CREATE DATABASE "${database}"`);
      url.pathname = `/${database}`;
      owner = new Pool({ connectionString: url.toString() });
      await owner.query(
        await readFile(
          new URL("../deploy/telemetry/schema.sql", import.meta.url),
          "utf8",
        ),
      );
      await owner.query(
        "GRANT USAGE ON SCHEMA telemetry TO telemetry_ingest, telemetry_reader; GRANT SELECT, INSERT, UPDATE, DELETE ON telemetry.panel_latest, telemetry.panel_daily TO telemetry_ingest; GRANT SELECT ON telemetry.latest_reports, telemetry.daily_reports, telemetry.daily_totals TO telemetry_reader;",
      );
      url.username = "telemetry_ingest";
      url.password = process.env.TELEMETRY_TEST_WRITER_PASSWORD!;
      store = new PostgresTelemetryStore(
        new Pool({ connectionString: url.toString() }),
      );
      url.username = "telemetry_reader";
      url.password = process.env.TELEMETRY_TEST_READER_PASSWORD!;
      reader = new Pool({ connectionString: url.toString() });
    });
    beforeEach(async () => {
      await owner.query(
        "TRUNCATE telemetry.panel_latest, telemetry.panel_daily",
      );
    });
    after(async () => {
      await reader?.end();
      await store?.close();
      await owner?.end();
      assert(/^telemetry_qa_[a-f0-9]{32}$/.test(database));
      await admin.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
      await admin.end();
    });
    const report = (when: string, users = 12) =>
      normalizeTelemetryPayload(
        { ...fixture, resources: { ...fixture.resources, users } },
        new Date(when),
      )!;

    test("updates one daily snapshot and keeps previous UTC days", async () => {
      await store.save(report("2026-10-11T23:59:59Z", 10));
      await store.save(report("2026-10-12T00:00:01Z", 12));
      await store.save(report("2026-10-12T12:00:00Z", 15));
      const daily = await reader.query(
        "SELECT reported_users FROM telemetry.daily_totals ORDER BY snapshot_date",
      );
      assert.deepEqual(
        daily.rows.map((row) => Number(row.reported_users)),
        [10, 15],
      );
      const latest = await reader.query(
        "SELECT user_count FROM telemetry.latest_reports",
      );
      assert.equal(Number(latest.rows[0].user_count), 15);
    });
    test("concurrent or delayed reports cannot overwrite a newer snapshot", async () => {
      await Promise.all(
        [15, 10, 5, 20].map((minute) =>
          store.save(
            report(
              `2026-10-12T12:${String(minute).padStart(2, "0")}:00Z`,
              minute,
            ),
          ),
        ),
      );
      assert.equal(
        Number(
          (
            await reader.query(
              "SELECT user_count FROM telemetry.latest_reports",
            )
          ).rows[0].user_count,
        ),
        20,
      );
      assert.equal(
        Number(
          (await reader.query("SELECT user_count FROM telemetry.daily_reports"))
            .rows[0].user_count,
        ),
        20,
      );
    });
    test("a failed daily write rolls back the latest report as well", async () => {
      await owner.query(
        "ALTER TABLE telemetry.panel_daily ADD CONSTRAINT qa_reject CHECK (user_count <> 42)",
      );
      try {
        await assert.rejects(store.save(report("2026-10-12T12:00:00Z", 42)));
        assert.equal(
          (await reader.query("SELECT count(*) FROM telemetry.latest_reports"))
            .rows[0].count,
          "0",
        );
      } finally {
        await owner.query(
          "ALTER TABLE telemetry.panel_daily DROP CONSTRAINT qa_reject",
        );
      }
    });
    test("prunes only reports older than the retention boundary", async () => {
      await store.save(report("2026-07-14T23:59:59Z"));
      await store.save(report("2026-07-15T00:00:00Z", 15));
      await store.prune(new Date("2026-07-15T00:00:00Z"));
      assert.equal(
        (await reader.query("SELECT count(*) FROM telemetry.daily_reports"))
          .rows[0].count,
        "1",
      );
      assert.equal(
        Number(
          (
            await reader.query(
              "SELECT user_count FROM telemetry.latest_reports",
            )
          ).rows[0].user_count,
        ),
        15,
      );
    });
    test(
      "Redis import preserves source keys, skips invalid records and surfaces storage failures",
      { skip: !process.env.TELEMETRY_TEST_REDIS_URL },
      async () => {
        const redis = createClient({
          url: process.env.TELEMETRY_TEST_REDIS_URL,
          disableOfflineQueue: true,
        });
        await redis.connect();
        const key = `telemetry:panel:${fixture.instanceId}`,
          invalidKey = "telemetry:panel:invalid";
        const contents = JSON.stringify({
          ...fixture,
          receivedAt: new Date().toISOString(),
          email: "do-not-save@example.invalid",
        });
        try {
          await redis.set(key, contents, { EX: 3600 });
          await redis.set(invalidKey, "not JSON");
          const databaseUrl = new URL(adminUrl!);
          databaseUrl.pathname = `/${database}`;
          databaseUrl.username = "telemetry_ingest";
          databaseUrl.password = process.env.TELEMETRY_TEST_WRITER_PASSWORD!;
          const env = {
            ...process.env,
            REDIS_URL: process.env.TELEMETRY_TEST_REDIS_URL,
            TELEMETRY_DATABASE_URL: databaseUrl.toString(),
          };
          const run = () =>
            spawnSync(
              process.execPath,
              ["--import", "tsx", "scripts/importTelemetry.ts"],
              { env, encoding: "utf8" },
            );
          const result = run();
          assert.equal(result.status, 0, result.stderr);
          assert.match(
            result.stdout,
            /Imported 1 latest Redis reports; skipped 1/,
          );
          assert.equal(await redis.get(key), contents);
          assert((await redis.ttl(key)) > 0);
          assert.equal(
            (
              await reader.query(
                "SELECT count(*) FROM telemetry.latest_reports",
              )
            ).rows[0].count,
            "1",
          );
          assert.equal(run().status, 0);
          assert.equal(
            (await reader.query("SELECT count(*) FROM telemetry.daily_reports"))
              .rows[0].count,
            "1",
          );
          databaseUrl.username = "telemetry_reader";
          databaseUrl.password = process.env.TELEMETRY_TEST_READER_PASSWORD!;
          env.TELEMETRY_DATABASE_URL = databaseUrl.toString();
          const failure = run();
          assert.equal(failure.status, 1);
          assert.match(failure.stderr, /Telemetry import failed/);
          assert.equal(await redis.get(key), contents);
        } finally {
          await redis.del([key, invalidKey]);
          await redis.close();
        }
      },
    );
    test("the reader can query views but cannot access base tables or modify data", async () => {
      await reader.query("SELECT * FROM telemetry.latest_reports");
      await assert.rejects(
        reader.query("SELECT * FROM telemetry.panel_latest"),
        { code: "42501" },
      );
      const client = await reader.connect();
      try {
        await client.query("SET default_transaction_read_only = off");
        await assert.rejects(
          client.query("DELETE FROM telemetry.latest_reports"),
          { code: "42501" },
        );
        await assert.rejects(
          client.query("CREATE TABLE telemetry.qa_forbidden (id integer)"),
          { code: "42501" },
        );
      } finally {
        client.release();
      }
    });
  },
);
