import assert from "node:assert/strict";
import { test } from "node:test";
import Fastify from "fastify";
import rateLimit from "@fastify/rate-limit";
import telemetryRoutes from "../routes/telemetry.js";
import {
  normalizeTelemetryPayload,
  type TelemetryReport,
} from "../config/telemetryPayload.js";
import type { TelemetryStore } from "../config/telemetryStore.js";

const receivedAt = new Date("2026-10-12T15:30:00Z");
export const payload = () => ({
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
});

function memoryStore() {
  const reports: TelemetryReport[] = [];
  const cutoffs: Date[] = [];
  const store: TelemetryStore = {
    save: async (report) => {
      reports.push(report);
    },
    prune: async (cutoff) => {
      cutoffs.push(cutoff);
    },
    close: async () => {},
  };
  return { store, reports, cutoffs };
}

test("receiver accepts existing panel reports and applies the server UTC timestamp", async () => {
  const app = Fastify();
  const { store, reports, cutoffs } = memoryStore();
  await app.register(telemetryRoutes, {
    prefix: "/telemetry",
    store,
    now: () => receivedAt,
  });
  try {
    const response = await app.inject({
      method: "POST",
      url: "/telemetry/panel",
      payload: {
        ...payload(),
        receivedAt: "1900-01-01",
        email: "do-not-save@example.invalid",
        panel: { ...payload().panel, token: "do-not-save" },
      },
    });
    assert.equal(response.statusCode, 202);
    assert.equal(reports.length, 1);
    assert.equal(reports[0].receivedAt.toISOString(), receivedAt.toISOString());
    assert(!JSON.stringify(reports).includes("do-not-save"));
    assert.equal(cutoffs[0].toISOString(), "2026-07-15T00:00:00.000Z");
    assert.equal((await app.inject("/telemetry/panel")).statusCode, 404);
  } finally {
    await app.close();
  }
});

test("legacy reports retain unknown optional counts as null rather than zero", () => {
  const report = normalizeTelemetryPayload(
    {
      schema: 1,
      instanceId: payload().instanceId.toUpperCase(),
      panel: {
        version: "canary",
        phpVersion: "8.4.0",
        databaseDriver: "mysql",
      },
    },
    receivedAt,
  )!;
  assert.equal(report.instanceId, payload().instanceId);
  assert.deepEqual(report.resources, {
    users: null,
    servers: null,
    nodes: null,
  });
  assert.equal(report.panel.docker, null);
});

test("legacy normalized reports remain valid when read back from Redis", () => {
  const minimal = {
    schema: 1,
    instanceId: payload().instanceId,
    panel: { version: "canary", phpVersion: "8.4.0", databaseDriver: "mysql" },
  };
  const serialized = JSON.stringify(
    normalizeTelemetryPayload(minimal, receivedAt),
  );
  assert.deepEqual(
    normalizeTelemetryPayload(JSON.parse(serialized), receivedAt),
    normalizeTelemetryPayload(minimal, receivedAt),
  );
});

test("Redis-only deployments keep working and store only approved fields", async () => {
  const configuredUrl = process.env.TELEMETRY_DATABASE_URL;
  delete process.env.TELEMETRY_DATABASE_URL;
  const app = Fastify();
  const writes: { key: string; value: string; ttl: number }[] = [];
  app.decorate("redis", {
    set: async (key: string, value: string, options: { EX: number }) => {
      writes.push({ key, value, ttl: options.EX });
    },
  });
  try {
    await app.register(telemetryRoutes, { now: () => receivedAt });
    const response = await app.inject({
      method: "POST",
      url: "/panel",
      payload: { ...payload(), ip: "do-not-save", credentials: "do-not-save" },
    });
    assert.equal(response.statusCode, 202);
    assert.equal(writes[0].key, `telemetry:panel:${payload().instanceId}`);
    assert.equal(writes[0].ttl, 90 * 86400);
    assert(!writes[0].value.includes("do-not-save"));
  } finally {
    await app.close();
    if (configuredUrl === undefined) delete process.env.TELEMETRY_DATABASE_URL;
    else process.env.TELEMETRY_DATABASE_URL = configuredUrl;
  }
});

for (const invalid of [
  null,
  [],
  {},
  { ...payload(), schema: 2 },
  { ...payload(), instanceId: "------------------------------------" },
  { ...payload(), instanceId: payload().instanceId + "\n" },
  { ...payload(), resources: [] },
  { ...payload(), resources: { users: -1 } },
  { ...payload(), resources: { servers: 1.5 } },
  { ...payload(), resources: { nodes: 1_000_000_001 } },
  { ...payload(), panel: { ...payload().panel, docker: "true" } },
  {
    ...payload(),
    panel: { ...payload().panel, version: "<img src=x onerror=alert(1)>" },
  },
  { ...payload(), panel: { ...payload().panel, phpVersion: "x".repeat(33) } },
]) {
  test(`rejects malformed or excessive telemetry: ${JSON.stringify(invalid).slice(0, 80)}`, () => {
    assert.equal(normalizeTelemetryPayload(invalid, receivedAt), null);
  });
}

test("rejects invalid bodies before any storage operation", async () => {
  const app = Fastify(),
    { store, reports } = memoryStore();
  await app.register(telemetryRoutes, { store });
  try {
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/panel",
          payload: { ...payload(), resources: { users: "secret" } },
        })
      ).statusCode,
      400,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/panel",
          payload: { ...payload(), excess: "x".repeat(32768) },
        })
      ).statusCode,
      413,
    );
    assert.equal(reports.length, 0);
  } finally {
    await app.close();
  }
});

test("reports storage outages without accepting or disclosing the report", async () => {
  const app = Fastify(),
    { store } = memoryStore();
  store.save = async () => {
    throw new Error("secret connection details");
  };
  await app.register(telemetryRoutes, { store });
  try {
    const response = await app.inject({
      method: "POST",
      url: "/panel",
      payload: payload(),
    });
    assert.equal(response.statusCode, 503);
    assert(!response.body.includes("secret"));
  } finally {
    await app.close();
  }
});

test("enforces the existing four reports per IP per hour limit", async () => {
  const app = Fastify(),
    { store, reports } = memoryStore();
  await app.register(rateLimit);
  await app.register(telemetryRoutes, { store });
  try {
    for (let index = 0; index < 4; index++)
      assert.equal(
        (
          await app.inject({
            method: "POST",
            url: "/panel",
            payload: payload(),
          })
        ).statusCode,
        202,
      );
    assert.equal(
      (await app.inject({ method: "POST", url: "/panel", payload: payload() }))
        .statusCode,
      429,
    );
    assert.equal(reports.length, 4);
  } finally {
    await app.close();
  }
});

test("rejects invalid retention settings instead of deleting reports", async () => {
  const app = Fastify(),
    { store } = memoryStore();
  app.register(telemetryRoutes, { store, retentionDays: -1 });
  try {
    await assert.rejects(async () => {
      await app.ready();
    }, /TELEMETRY_RETENTION_DAYS/);
  } finally {
    await app.close();
  }
});
