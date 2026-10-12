import type { FastifyPluginAsync } from "fastify";
import {
  createTelemetryStore,
  type TelemetryStore,
} from "../config/telemetryStore.js";
import { normalizeTelemetryPayload } from "../config/telemetryPayload.js";

interface TelemetryOptions {
  store?: TelemetryStore;
  now?: () => Date;
  retentionDays?: number;
}

const registerTelemetryRoutes: FastifyPluginAsync<TelemetryOptions> = async (
  app,
  options,
) => {
  const now = options.now ?? (() => new Date());
  const retentionDays =
    options.retentionDays ?? Number(process.env.TELEMETRY_RETENTION_DAYS || 90);
  if (
    !Number.isInteger(retentionDays) ||
    retentionDays < 1 ||
    retentionDays > 3650
  ) {
    throw new Error(
      "TELEMETRY_RETENTION_DAYS must be an integer between 1 and 3650.",
    );
  }
  const store =
    options.store ??
    createTelemetryStore(process.env.TELEMETRY_DATABASE_URL, (code) => {
      app.log.error({ code }, "Telemetry PostgreSQL connection error");
    });
  const redis = (
    app as typeof app & {
      redis?: {
        set(
          key: string,
          value: string,
          options: { EX: number },
        ): Promise<unknown>;
      };
    }
  ).redis;
  if (!store && !redis)
    throw new Error("Telemetry requires PostgreSQL or Redis.");

  let cleanup: ReturnType<typeof setInterval> | undefined;
  if (store) {
    const prune = async () => {
      const cutoff = new Date(now());
      cutoff.setUTCHours(0, 0, 0, 0);
      cutoff.setUTCDate(cutoff.getUTCDate() - retentionDays + 1);
      await store.prune(cutoff);
    };
    app.addHook("onReady", async () => {
      await prune();
      cleanup = setInterval(
        () => {
          void prune().catch(() =>
            app.log.error("Telemetry retention cleanup failed"),
          );
        },
        24 * 60 * 60 * 1000,
      );
      cleanup.unref();
    });
    app.addHook("onClose", async () => {
      if (cleanup) clearInterval(cleanup);
      await store.close();
    });
  }

  app.post(
    "/panel",
    {
      bodyLimit: 32_768,
      config: { rateLimit: { max: 4, timeWindow: "1 hour" } },
    },
    async (request, reply) => {
      const report = normalizeTelemetryPayload(request.body, now());
      if (!report)
        return reply
          .code(400)
          .send({ success: false, error: "Invalid telemetry payload" });
      try {
        if (store) await store.save(report);
        else
          await redis!.set(
            `telemetry:panel:${report.instanceId}`,
            JSON.stringify(report),
            { EX: retentionDays * 86400 },
          );
      } catch {
        app.log.error("Telemetry report could not be stored");
        return reply
          .code(503)
          .send({ success: false, error: "Telemetry storage unavailable" });
      }
      return reply.code(202).send({ accepted: true });
    },
  );
};

export default registerTelemetryRoutes;
