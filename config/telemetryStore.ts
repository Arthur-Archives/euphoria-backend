import { Pool } from "pg";
import type { TelemetryReport } from "./telemetryPayload.js";

export interface TelemetryStore {
  save(report: TelemetryReport): Promise<void>;
  prune(cutoff: Date): Promise<void>;
  close(): Promise<void>;
}
const columns =
  "instance_id, received_at, panel_version, php_version, database_driver, cache_driver, queue_driver, docker, user_count, server_count, node_count";
const placeholders = Array.from(
  { length: 11 },
  (_, index) => `$${index + 1}`,
).join(", ");
const updates = columns
  .split(", ")
  .slice(1)
  .map((column) => `${column} = EXCLUDED.${column}`)
  .join(", ");

export class PostgresTelemetryStore implements TelemetryStore {
  constructor(private pool: Pool) {}

  async save(report: TelemetryReport): Promise<void> {
    const values = [
      report.instanceId,
      report.receivedAt,
      report.panel.version,
      report.panel.phpVersion,
      report.panel.databaseDriver,
      report.panel.cacheDriver,
      report.panel.queueDriver,
      report.panel.docker,
      report.resources.users,
      report.resources.servers,
      report.resources.nodes,
    ];
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO telemetry.panel_latest (${columns}) VALUES (${placeholders})
        ON CONFLICT (instance_id) DO UPDATE SET ${updates}
        WHERE panel_latest.received_at <= EXCLUDED.received_at`,
        values,
      );
      await client.query(
        `INSERT INTO telemetry.panel_daily (${columns}, snapshot_date) VALUES (${placeholders}, $12::date)
        ON CONFLICT (instance_id, snapshot_date) DO UPDATE SET ${updates}
        WHERE panel_daily.received_at <= EXCLUDED.received_at`,
        [...values, report.receivedAt.toISOString().slice(0, 10)],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async prune(cutoff: Date): Promise<void> {
    await this.pool.query(
      "DELETE FROM telemetry.panel_daily WHERE snapshot_date < $1::date",
      [cutoff.toISOString().slice(0, 10)],
    );
    await this.pool.query(
      "DELETE FROM telemetry.panel_latest WHERE received_at < $1",
      [cutoff],
    );
  }
  async close(): Promise<void> {
    await this.pool.end();
  }
}

export function createTelemetryStore(
  connectionString: string | undefined,
  onError: (code: string | undefined) => void,
): TelemetryStore | undefined {
  if (!connectionString) return undefined;
  const pool = new Pool({
    connectionString,
    max: 5,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    statement_timeout: 5000,
    application_name: "ed-api-telemetry",
  });
  pool.on("error", (error) =>
    onError((error as Error & { code?: string }).code),
  );
  return new PostgresTelemetryStore(pool);
}
