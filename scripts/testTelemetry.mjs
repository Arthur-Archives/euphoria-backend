import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { parse } from "dotenv";

const configuration = parse(readFileSync(".env.telemetry"));
const url = new URL(
  `postgres://postgres@127.0.0.1:${configuration.TELEMETRY_DATABASE_PORT || 55432}/postgres`,
);
url.password = configuration.POSTGRES_PASSWORD;
const redisName = `telemetry-qa-redis-${randomUUID()}`;
function docker(args) {
  const result = spawnSync("docker", args, { encoding: "utf8" });
  if (result.status !== 0)
    throw new Error(
      "Could not run the disposable Redis integration-test container.",
    );
  return result.stdout.trim();
}
try {
  docker([
    "run",
    "-d",
    "--rm",
    "--name",
    redisName,
    "-p",
    "127.0.0.1::6379",
    "redis:7-alpine",
  ]);
  const port = docker(["port", redisName, "6379"]).match(
    /^127\.0\.0\.1:(\d+)$/,
  )?.[1];
  if (!port) throw new Error("Could not resolve the test Redis port.");
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "--test", "tests/telemetry-postgres.test.ts"],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        TELEMETRY_TEST_ADMIN_URL: url.toString(),
        TELEMETRY_TEST_WRITER_PASSWORD: configuration.TELEMETRY_WRITER_PASSWORD,
        TELEMETRY_TEST_READER_PASSWORD: configuration.TELEMETRY_READER_PASSWORD,
        TELEMETRY_TEST_REDIS_URL: `redis://127.0.0.1:${port}`,
      },
    },
  );
  process.exitCode = result.status ?? 1;
} finally {
  spawnSync("docker", ["stop", redisName], { stdio: "ignore" });
}
