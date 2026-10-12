import { randomBytes } from "node:crypto";
import { writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const file = resolve(".env.telemetry");
if (existsSync(file)) {
  console.log(
    ".env.telemetry already exists; existing credentials were preserved.",
  );
} else {
  const email =
    process.argv
      .find((argument) => argument.startsWith("--email="))
      ?.slice(8) || "admin@telemetry.local";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new Error("Use --email=you@example.com with a valid email address.");
  const secret = () => randomBytes(32).toString("base64url");
  const values = {
    POSTGRES_PASSWORD: secret(),
    TELEMETRY_WRITER_PASSWORD: secret(),
    TELEMETRY_READER_PASSWORD: secret(),
    METABASE_DB_PASSWORD: secret(),
    METABASE_ADMIN_EMAIL: email,
    METABASE_ADMIN_PASSWORD: `T1!${secret()}`,
    METABASE_ENCRYPTION_SECRET_KEY: secret(),
    METABASE_SITE_URL: "http://localhost:3013",
    METABASE_PORT: "3013",
    TELEMETRY_DATABASE_PORT: "55432",
    TELEMETRY_PREVIEW_PORT: "3014",
    TELEMETRY_RETENTION_DAYS: "90",
  };
  writeFileSync(
    file,
    "# Private credentials: do not commit or share this file.\n" +
      Object.entries(values)
        .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
        .join("\n") +
      "\n",
    { mode: 0o600, flag: "wx" },
  );
  console.log(
    "Created .env.telemetry with unique credentials. Login details are in METABASE_ADMIN_EMAIL and METABASE_ADMIN_PASSWORD.",
  );
}
