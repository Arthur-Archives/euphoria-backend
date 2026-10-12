import dotenv from "dotenv";
import { createClient } from "redis";
import { normalizeTelemetryPayload } from "../config/telemetryPayload.js";
import { createTelemetryStore } from "../config/telemetryStore.js";

dotenv.config({ quiet: true });
const store = createTelemetryStore(
  process.env.TELEMETRY_DATABASE_URL,
  () => {},
);
if (!store || !process.env.REDIS_URL)
  throw new Error(
    "Configure TELEMETRY_DATABASE_URL and REDIS_URL in the API .env first.",
  );
const redis = createClient({
  url: process.env.REDIS_URL,
  disableOfflineQueue: true,
});
redis.on("error", () => {});
let imported = 0,
  skipped = 0;
const retentionDays = Number(process.env.TELEMETRY_RETENTION_DAYS || 90);
if (
  !Number.isInteger(retentionDays) ||
  retentionDays < 1 ||
  retentionDays > 3650
)
  throw new Error("Invalid retention setting");
try {
  await redis.connect();
  for await (const keys of redis.scanIterator({
    MATCH: "telemetry:panel:*",
    COUNT: 100,
  })) {
    for (const key of keys) {
      const contents = await redis.get(key);
      let report;
      try {
        const raw = JSON.parse(contents || "null");
        const receivedAt = new Date(raw?.receivedAt);
        report = normalizeTelemetryPayload(raw, receivedAt);
        if (
          !report ||
          typeof raw.receivedAt !== "string" ||
          !Number.isFinite(receivedAt.getTime()) ||
          receivedAt.getTime() > Date.now()
        ) {
          skipped++;
          continue;
        }
      } catch {
        skipped++;
        continue;
      }
      // Storage failures must abort the import, not be counted as invalid input.
      await store.save(report);
      imported++;
    }
  }
  const cutoff = new Date();
  cutoff.setUTCHours(0, 0, 0, 0);
  cutoff.setUTCDate(cutoff.getUTCDate() - retentionDays + 1);
  await store.prune(cutoff);
  console.log(
    `Imported ${imported} latest Redis reports; skipped ${skipped}. Existing Redis keys were preserved. Earlier daily history cannot be reconstructed.`,
  );
} catch {
  console.error(
    "Telemetry import failed. Check the configured Redis/PostgreSQL connections and database permissions.",
  );
  process.exitCode = 1;
} finally {
  if (redis.isOpen) await redis.close();
  await store.close();
}
