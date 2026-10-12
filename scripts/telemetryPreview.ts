import Fastify from "fastify";
import rateLimit from "@fastify/rate-limit";
import telemetryRoutes from "../routes/telemetry.js";

// Local preview uses the same receiver as the main API, without starting its
// licensing, game queries, translation sync or other unrelated services.
const app = Fastify({ logger: true, disableRequestLogging: true });
await app.register(rateLimit);
await app.register(telemetryRoutes, { prefix: "/telemetry" });
app.get("/health", async () => ({ ok: true }));
await app.listen({ port: Number(process.env.PORT || 3000), host: "0.0.0.0" });
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void app.close();
  });
}
