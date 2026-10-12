export interface TelemetryReport {
  schema: 1;
  instanceId: string;
  receivedAt: Date;
  panel: {
    version: string;
    phpVersion: string;
    databaseDriver: string;
    cacheDriver: string | null;
    queueDriver: string | null;
    docker: boolean | null;
  };
  resources: {
    users: number | null;
    servers: number | null;
    nodes: number | null;
  };
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function version(value: unknown, max: number): value is string {
  return (
    typeof value === "string" &&
    value === value.trim() &&
    value.length <= max &&
    /^[a-z0-9.+_-]+$/i.test(value)
  );
}
function driver(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value === value.trim() &&
    value.length <= 32 &&
    /^[a-z][a-z0-9_-]*$/i.test(value)
  );
}
function count(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    (typeof value === "number" &&
      Number.isSafeInteger(value) &&
      value >= 0 &&
      value <= 1_000_000_000)
  );
}

export function normalizeTelemetryPayload(
  value: unknown,
  receivedAt: Date,
): TelemetryReport | null {
  const payload = object(value);
  const panel = object(payload?.panel);
  const resources =
    payload?.resources === undefined ? {} : object(payload.resources);
  if (
    !payload ||
    !panel ||
    !resources ||
    payload.schema !== 1 ||
    typeof payload.instanceId !== "string" ||
    !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(
      payload.instanceId,
    ) ||
    payload.instanceId.length !== 36 ||
    !version(panel.version, 64) ||
    !version(panel.phpVersion, 32) ||
    !driver(panel.databaseDriver) ||
    (panel.cacheDriver != null && !driver(panel.cacheDriver)) ||
    (panel.queueDriver != null && !driver(panel.queueDriver)) ||
    (panel.docker != null && typeof panel.docker !== "boolean") ||
    ![resources.users, resources.servers, resources.nodes].every(count)
  )
    return null;

  // Only copy approved aggregate fields. Never persist extra identity/network
  // data, credentials, or a client-supplied received timestamp.
  return {
    schema: 1,
    instanceId: payload.instanceId.toLowerCase(),
    receivedAt,
    panel: {
      version: panel.version,
      phpVersion: panel.phpVersion,
      databaseDriver: panel.databaseDriver,
      cacheDriver: (panel.cacheDriver as string | null | undefined) ?? null,
      queueDriver: (panel.queueDriver as string | null | undefined) ?? null,
      docker: (panel.docker as boolean | null | undefined) ?? null,
    },
    resources: {
      users: (resources.users as number | null | undefined) ?? null,
      servers: (resources.servers as number | null | undefined) ?? null,
      nodes: (resources.nodes as number | null | undefined) ?? null,
    },
  };
}
