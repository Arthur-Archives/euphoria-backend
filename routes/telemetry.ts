const TELEMETRY_REDIS_PREFIX = "telemetry:panel:";
const MAX_PAYLOAD_BYTES = 32_768;

function isValidPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return false;
  }

  return (
    payload.schema === 1 &&
    typeof payload.instanceId === "string" &&
    /^[0-9a-f-]{36}$/i.test(payload.instanceId) &&
    typeof payload.panel?.version === "string" &&
    typeof payload.panel?.phpVersion === "string" &&
    typeof payload.panel?.databaseDriver === "string"
  );
}

export default async function registerTelemetryRoutes(app) {
  app.post(
    "/panel",
    {
      config: {
        rateLimit: {
          max: 4,
          timeWindow: "1 hour",
        },
      },
    },
    async (request, reply) => {
      if (Buffer.byteLength(JSON.stringify(request.body || {}), "utf8") > MAX_PAYLOAD_BYTES) {
        return reply.code(413).send({ success: false, error: "Payload too large" });
      }

      if (!isValidPayload(request.body)) {
        return reply.code(400).send({ success: false, error: "Invalid telemetry payload" });
      }

      const payload = {
        ...request.body,
        receivedAt: new Date().toISOString(),
      };
      await app.redis.set(
        `${TELEMETRY_REDIS_PREFIX}${payload.instanceId}`,
        JSON.stringify(payload),
        { EX: 60 * 60 * 24 * 90 },
      );

      return reply.code(202).send({ accepted: true });
    },
  );
}
