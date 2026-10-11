import Fastify, { LogController } from "fastify";
import fastifyCors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import fastifyRateLimit from "@fastify/rate-limit";
import fastifyFormbody from "@fastify/formbody";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import { createClient } from "redis";
import { createOpenApiDocument, renderScalarHtml } from "./config/apiDocs.js";
import { recordRequestDuration } from "./config/runtimeMetrics.js";
import { startTranslationSyncJob } from "./scripts/syncTranslations.js";
import { startBlueprintSyncJob } from "./scripts/syncBlueprintExtensions.js";
import licenseRoutes from "./routes/license.js";
import gameApiRoutes from "./routes/gameapi.js";
import translationApiRoutes from "./routes/translations.js";
import productsRoutes from "./routes/products.js";
import donatorsRoutes from "./routes/donators.js";
import contributorsRoutes from "./routes/contributors.js";
import teamRoutes from "./routes/team.js";
import versionsRoutes from "./routes/versions.js";
import statsRoutes from "./routes/stats.js";
import rconRoutes from "./routes/rcon.js";
import telemetryRoutes from "./routes/telemetry.js";

dotenv.config({ quiet: true });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const logsDir = path.join(__dirname, "logs");

const REQUEST_BODY_LIMIT_BYTES = Number.parseInt(
  process.env.REQUEST_BODY_LIMIT_BYTES || "1048576",
  10,
);
const REQUEST_TIMEOUT_MS = Number.parseInt(
  process.env.REQUEST_TIMEOUT_MS || "15000",
  10,
);
const CONNECTION_TIMEOUT_MS = Number.parseInt(
  process.env.CONNECTION_TIMEOUT_MS || "10000",
  10,
);
const KEEP_ALIVE_TIMEOUT_MS = Number.parseInt(
  process.env.KEEP_ALIVE_TIMEOUT_MS || "5000",
  10,
);
const API_STATS_FLUSH_INTERVAL_MS = Number.parseInt(
  process.env.API_STATS_FLUSH_INTERVAL_MS || "5000",
  10,
);
const REDIS_URL = process.env.REDIS_URL;
const API_REQUEST_COUNT_KEY = "stats:api-request-count";
const REQUEST_LOGGING_ENABLED = process.env.REQUEST_LOGGING_ENABLED === "true";
const FASTIFY_LOG_LEVEL = process.env.FASTIFY_LOG_LEVEL || "info";
const FASTIFY_DISABLE_REQUEST_LOGGING =
  process.env.FASTIFY_DISABLE_REQUEST_LOGGING !== "false";
const CORS_ENABLED = process.env.CORS_ENABLED !== "false";
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";
const CORS_METHODS = String(
  process.env.CORS_METHODS || "GET,POST,PUT,PATCH,DELETE,OPTIONS,HEAD",
)
  .split(",")
  .map((method) => method.trim().toUpperCase())
  .filter(Boolean);
const RATE_LIMIT_ENABLED = process.env.RATE_LIMIT_ENABLED !== "false";
const RATE_LIMIT_MAX = Number.parseInt(process.env.RATE_LIMIT_MAX || "120", 10);
const RATE_LIMIT_TIME_WINDOW = process.env.RATE_LIMIT_TIME_WINDOW || "1 minute";
const RATE_LIMIT_ALLOW_LIST = String(process.env.RATE_LIMIT_ALLOW_LIST || "")
  .split(",")
  .map((ip) => ip.trim())
  .filter(Boolean);
const API_DOCS_ENABLED = process.env.API_DOCS_ENABLED !== "false";
const API_DOCS_PATH = process.env.API_DOCS_PATH || "/docs";
const OPENAPI_JSON_PATH = process.env.OPENAPI_JSON_PATH || "/openapi.json";
const STATIC_IMAGE_CACHE_CONTROL =
  "public, max-age=86400, stale-while-revalidate=604800";
const STATIC_IMAGE_PATTERN = /\.(?:avif|gif|ico|jpe?g|png|svg|webp)$/i;
const DEFAULT_CONTENT_SECURITY_POLICY =
  "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; upgrade-insecure-requests";
const DOCS_CONTENT_SECURITY_POLICY =
  "default-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; script-src 'self' https://cdn.jsdelivr.net; connect-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline' https:; font-src 'self' data: https:; worker-src 'self' blob:; upgrade-insecure-requests";
const PROXY_MODE = String(process.env.PROXY_MODE || "direct").toLowerCase();
const TRUST_PROXY_HOPS = Number.parseInt(
  process.env.TRUST_PROXY_HOPS || "1",
  10,
);
const TRUST_PROXY =
  process.env.TRUST_PROXY === "true" || PROXY_MODE !== "direct";

function normalizeIp(value) {
  const ip = String(value || "").trim();
  return ip.replace(/^::ffff:/, "");
}

function getFirstForwardedFor(request) {
  return normalizeIp(
    String(request.headers["x-forwarded-for"] || "").split(",")[0],
  );
}

function resolveClientIp(request) {
  const cloudflareIp = normalizeIp(request.headers["cf-connecting-ip"]);
  const trueClientIp = normalizeIp(request.headers["true-client-ip"]);
  const realIp = normalizeIp(request.headers["x-real-ip"]);
  const forwardedFor = getFirstForwardedFor(request);
  const fastifyIp = normalizeIp(request.ip);
  const socketIp = normalizeIp(request.raw?.socket?.remoteAddress);

  if (PROXY_MODE === "cloudflare") {
    return (
      cloudflareIp ||
      trueClientIp ||
      realIp ||
      forwardedFor ||
      fastifyIp ||
      socketIp
    );
  }

  if (PROXY_MODE === "nginx") {
    return realIp || forwardedFor || fastifyIp || socketIp;
  }

  return fastifyIp || socketIp;
}

function resolvePublicBaseUrl(request) {
  const protoHeader = String(request.headers["x-forwarded-proto"] || "")
    .split(",")[0]
    .trim()
    .toLowerCase();
  const protocol = protoHeader || request.protocol || "http";
  const forwardedHost = String(request.headers["x-forwarded-host"] || "")
    .split(",")[0]
    .trim();
  const host = forwardedHost || String(request.headers.host || "").trim();

  if (!host) {
    return `${protocol}://localhost`;
  }

  return `${protocol}://${host}`;
}

const app = Fastify({
  logger: { level: FASTIFY_LOG_LEVEL },
  logController: new LogController({
    disableRequestLogging: FASTIFY_DISABLE_REQUEST_LOGGING,
  }),
  trustProxy: TRUST_PROXY ? TRUST_PROXY_HOPS : false,
  bodyLimit: REQUEST_BODY_LIMIT_BYTES,
  requestTimeout: REQUEST_TIMEOUT_MS,
  connectionTimeout: CONNECTION_TIMEOUT_MS,
  keepAliveTimeout: KEEP_ALIVE_TIMEOUT_MS,
  routerOptions: {
    maxParamLength: 128,
  },
});

if (!REDIS_URL) {
  throw new Error("REDIS_URL must be configured.");
}

const redis = createClient({
  url: REDIS_URL,
  disableOfflineQueue: true,
});

redis.on("error", (error) => {
  app.log.error({ err: error }, "Redis connection error");
});

if (CORS_ENABLED) {
  await app.register(fastifyCors, {
    origin: CORS_ORIGIN,
    methods: CORS_METHODS,
  });
}

await app.register(fastifyFormbody);

if (RATE_LIMIT_ENABLED) {
  await app.register(fastifyRateLimit, {
    global: true,
    max: RATE_LIMIT_MAX,
    timeWindow: RATE_LIMIT_TIME_WINDOW,
    allowList: RATE_LIMIT_ALLOW_LIST,
    keyGenerator: (request) => request.clientIp || request.ip,
  });
}

await app.register(fastifyStatic, {
  root: path.join(__dirname, "public"),
  prefix: "/public/",
  setHeaders: (reply, filePath) => {
    if (STATIC_IMAGE_PATTERN.test(filePath)) {
      reply.header("Cache-Control", STATIC_IMAGE_CACHE_CONTROL);
    }
  },
});

let apiRequestCount = 0;
let pendingApiRequestCount = 0;
let statsFlushInFlight = false;
let activeLogDate = "";
let activeLogStream = null;
let isShuttingDown = false;

app.decorate("getApiRequestCount", () => apiRequestCount);
app.decorate("redis", redis);

// Serialize access log stream rotation across concurrent requests.
let accessLogMutex = Promise.resolve();
function withAccessLogLock(fn) {
  const run = accessLogMutex
    .then(() => fn())
    .catch((err) => {
      app.log.error({ err }, "access log rotation failed");
      return null;
    });

  accessLogMutex = run.then(
    () => undefined,
    () => undefined,
  );

  return run;
}

async function flushApiStats() {
  if (pendingApiRequestCount === 0 || statsFlushInFlight) {
    return;
  }

  const countToFlush = pendingApiRequestCount;
  pendingApiRequestCount = 0;
  statsFlushInFlight = true;
  try {
    await redis.incrBy(API_REQUEST_COUNT_KEY, countToFlush);
  } catch (error) {
    pendingApiRequestCount += countToFlush;
    app.log.error({ err: error }, "failed to flush API stats to Redis");
  } finally {
    statsFlushInFlight = false;
  }
}

function incrementApiCounter() {
  apiRequestCount += 1;
  pendingApiRequestCount += 1;
}

function getAccessLogStreamFor(dateKey) {
  return withAccessLogLock(() => {
    if (activeLogStream && activeLogDate === dateKey) {
      return activeLogStream;
    }

    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }

    if (activeLogStream) {
      try {
        activeLogStream.end();
      } catch {
        // no-op
      }
    }

    activeLogDate = dateKey;
    activeLogStream = fs.createWriteStream(
      path.join(logsDir, `${dateKey}.log`),
      { flags: "a" },
    );
    activeLogStream.on("error", (error) => {
      app.log.error({ err: error }, "request access log stream failed");
      try {
        activeLogStream?.end();
      } catch {
        // no-op
      }
      activeLogStream = null;
    });

    return activeLogStream;
  });
}

async function logApiCall(request) {
  if (!REQUEST_LOGGING_ENABLED || isShuttingDown) {
    return;
  }

  const now = new Date();
  const dateKey = now.toISOString().slice(0, 10);
  const stream = await getAccessLogStreamFor(dateKey);

  if (!stream || typeof stream.write !== "function") {
    return;
  }

  const sourceDomain = request.headers.origin || request.headers.referer || "";
  const sourceIp =
    request.clientIp || request.ip || request.raw?.socket?.remoteAddress || "";
  const target = request.raw?.url || request.url || "";

  const logEntry = {
    time: now.toISOString(),
    source: { domain: sourceDomain, ip: sourceIp },
    target,
    body: null,
  };

  stream.write(`${JSON.stringify(logEntry)}\n`);
}

app.addHook("onRequest", async (request) => {
  request.metricsStartedAt = performance.now();
  request.clientIp = resolveClientIp(request);
  incrementApiCounter();
  await logApiCall(request);
});

app.addHook("onResponse", async (request) => {
  const startedAt = request.metricsStartedAt;
  if (typeof startedAt === "number") {
    recordRequestDuration(performance.now() - startedAt);
  }
});

app.addHook("onSend", async (request, reply, payload) => {
  reply.header("X-Content-Type-Options", "nosniff");
  reply.header("X-Frame-Options", "DENY");
  reply.header("Referrer-Policy", "no-referrer");
  reply.header("X-DNS-Prefetch-Control", "off");
  reply.header("X-Permitted-Cross-Domain-Policies", "none");
  reply.header("Cross-Origin-Opener-Policy", "same-origin");
  reply.header("Origin-Agent-Cluster", "?1");
  reply.header(
    "Permissions-Policy",
    "accelerometer=(), autoplay=(), camera=(), display-capture=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()",
  );
  const requestPath = String(request.url || "").split("?", 1)[0];
  reply.header(
    "Content-Security-Policy",
    requestPath === API_DOCS_PATH
      ? DOCS_CONTENT_SECURITY_POLICY
      : DEFAULT_CONTENT_SECURITY_POLICY,
  );

  const forwardedProto = String(
    request.headers["x-forwarded-proto"] || "",
  ).toLowerCase();
  if (forwardedProto === "https") {
    reply.header(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains",
    );
  }

  return payload;
});

function resolvePublicErrorMessage(error, statusCode) {
  if (
    error?.code === "FST_ERR_VALIDATION" &&
    Array.isArray(error.validation) &&
    error.validation.length > 0
  ) {
    const firstValidationError = error.validation[0];
    const validationContext = String(error.validationContext || "request");
    return `Invalid ${validationContext}: ${firstValidationError.message}`;
  }

  if (
    statusCode >= 400 &&
    statusCode < 500 &&
    typeof error?.message === "string" &&
    error.message.trim()
  ) {
    return error.message;
  }

  return "Internal server error";
}

app.setErrorHandler((error, request, reply) => {
  request.log.error({ err: error }, "unhandled request error");
  if (!reply.sent) {
    const statusCode =
      error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
    reply.code(statusCode).send({
      success: false,
      error: resolvePublicErrorMessage(error, statusCode),
    });
  }
});

app.setNotFoundHandler((request, reply) => {
  reply.code(404).send({
    success: false,
    error: "Route not found",
    path: request.url,
  });
});

if (API_DOCS_ENABLED) {
  app.get(
    OPENAPI_JSON_PATH,
    {
      config: {
        rateLimit: false,
      },
    },
    async (request, reply) => {
      const baseUrl = resolvePublicBaseUrl(request);
      return reply.send(createOpenApiDocument(baseUrl));
    },
  );

  app.get(
    API_DOCS_PATH,
    {
      config: {
        rateLimit: false,
      },
    },
    async (request, reply) => {
      const baseUrl = resolvePublicBaseUrl(request);
      const openApiUrl = `${baseUrl}${OPENAPI_JSON_PATH}`;
      reply.type("text/html; charset=utf-8");
      return reply.send(renderScalarHtml({ specUrl: openApiUrl }));
    },
  );
}

await app.register(licenseRoutes, { prefix: "/license" });
await app.register(gameApiRoutes, { prefix: "/gameapi" });
await app.register(translationApiRoutes, { prefix: "/translations" });
await app.register(productsRoutes, { prefix: "/products" });
await app.register(donatorsRoutes, { prefix: "/donators" });
await app.register(contributorsRoutes, { prefix: "/contributors" });
await app.register(teamRoutes, { prefix: "/team" });
await app.register(versionsRoutes, { prefix: "/versions" });
await app.register(statsRoutes, { prefix: "/stats" });
await app.register(rconRoutes, { prefix: "/rcon" });
await app.register(telemetryRoutes, { prefix: "/telemetry" });

app.get("/", async (request) => ({
  ok: true,
  service: "backend",
  docs: API_DOCS_ENABLED
    ? `${resolvePublicBaseUrl(request)}${API_DOCS_PATH}`
    : null,
  openapi: API_DOCS_ENABLED
    ? `${resolvePublicBaseUrl(request)}${OPENAPI_JSON_PATH}`
    : null,
  health: `${resolvePublicBaseUrl(request)}/health`,
  time: new Date().toISOString(),
}));
app.get("/health", async () => ({
  ok: true,
  service: "backend",
  time: new Date().toISOString(),
}));

let jobsStarted = false;
let statsInterval = null;
let translationSyncInterval = null;
let blueprintSyncInterval = null;
function startJobs() {
  if (jobsStarted) {
    return;
  }

  jobsStarted = true;
  translationSyncInterval = startTranslationSyncJob();
  blueprintSyncInterval = startBlueprintSyncJob();

  statsInterval = setInterval(() => {
    flushApiStats();
  }, API_STATS_FLUSH_INTERVAL_MS);

  if (statsInterval.unref) {
    statsInterval.unref();
  }

  if (translationSyncInterval.unref) {
    translationSyncInterval.unref();
  }

  if (blueprintSyncInterval.unref) {
    blueprintSyncInterval.unref();
  }
}

const PORT = Number.parseInt(process.env.PORT || "3000", 10);
const HOST = process.env.HOST || "0.0.0.0";

async function start() {
  try {
    await redis.connect();
    apiRequestCount = Number((await redis.get(API_REQUEST_COUNT_KEY)) || 0);
    await app.listen({ port: PORT, host: HOST });
    app.log.info(`Fastify server running on ${HOST}:${PORT}`);
    startJobs();
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

start();

async function closeAccessLogStream() {
  const stream = activeLogStream;
  activeLogStream = null;

  if (!stream) {
    return;
  }

  await new Promise((resolve) => {
    stream.once("error", resolve);
    stream.end(resolve);
  });
}

async function shutdown(signal, exitCode = 0) {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;

  try {
    app.log.info(`Received ${signal}, shutting down.`);

    if (statsInterval) {
      clearInterval(statsInterval);
      statsInterval = null;
    }
    if (translationSyncInterval) {
      clearInterval(translationSyncInterval);
      translationSyncInterval = null;
    }
    if (blueprintSyncInterval) {
      clearInterval(blueprintSyncInterval);
      blueprintSyncInterval = null;
    }

    // Stop accepting new connections and wait for in-flight requests first.
    await app.close();
    await flushApiStats();
    await redis.close();
    await closeAccessLogStream();

    app.log.info("Graceful shutdown completed.");
    process.exit(exitCode);
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});

process.on("unhandledRejection", (reason) => {
  app.log.error({ err: reason }, "unhandled promise rejection");
  void shutdown("unhandledRejection", 1);
});

process.on("uncaughtException", (error) => {
  app.log.error({ err: error }, "uncaught exception");
  void shutdown("uncaughtException", 1);
});
