# Private Aquadactyl telemetry dashboard

The public API continues to accept `POST /telemetry/panel`. With
`TELEMETRY_DATABASE_URL` configured, it stores each installation's latest report
and one snapshot per UTC calendar day in PostgreSQL. Metabase provides a private
dashboard for the reports. Panels keep their existing opt-in setting and URL.

The dashboard includes reporting installations and reported user/server/node
counts for the last seven days, daily trends, panel/PHP version distributions,
Docker usage, and the last contact for up to 1,000 installations. Its History
(days) filter controls the trend charts. These are anonymous, self-reported,
opt-in figures, not a count of every deployment or unique people across panels.

## Start on Linux or preview locally

From the backend repository, install the locked dependencies and generate
private credentials. Use your own email on Linux; omit `--email` for the local
preview account `admin@telemetry.local`.

```bash
pnpm install --frozen-lockfile
pnpm telemetry:init --email=you@example.com
docker compose --env-file .env.telemetry -f compose.telemetry.yaml up -d --wait --wait-timeout 600 postgres metabase
docker compose --env-file .env.telemetry -f compose.telemetry.yaml run --rm setup
```

Open **http://localhost:3013** and sign in with `METABASE_ADMIN_EMAIL` and
`METABASE_ADMIN_PASSWORD` from `.env.telemetry`. Setup prints the dashboard's
direct URL. It creates the administrator, read-only data connection, restricted
collection, charts, and history filter automatically. Repeating setup preserves
an existing dashboard's customizations; repeating credential initialization
preserves the existing file. Credentials are generated randomly and git-ignored.

The local preview receiver is optional:

```bash
docker compose --env-file .env.telemetry -f compose.telemetry.yaml --profile preview up -d --build --wait --wait-timeout 600 preview-api
```

It listens on **http://localhost:3014/telemetry/panel**, uses the exact receiver
from the API, and does not start unrelated API services. The dashboard initially
has no reports. Do not point a production panel at the preview URL.

PostgreSQL, Metabase, and the preview receiver bind to loopback. For remote
access to a Linux installation, an SSH tunnel is sufficient:

```bash
ssh -L 3013:127.0.0.1:3013 user@api-host
```

Alternatively put Metabase behind an existing HTTPS virtual host, using
`deploy/telemetry/nginx.conf.example`, and set `METABASE_SITE_URL` in
`.env.telemetry` to that HTTPS URL before starting Metabase. Authentication
remains required. Public dashboard sharing, embedding, and Metabase's own
anonymous tracking are disabled. Only administrators can access the generated
telemetry collection.

## Connect the real API

On the API host, add these settings to its existing `.env`:

```dotenv
TELEMETRY_DATABASE_URL=postgres://telemetry_ingest:WRITER_PASSWORD@127.0.0.1:55432/telemetry
TELEMETRY_RETENTION_DAYS=90
```

Use `TELEMETRY_WRITER_PASSWORD` from `.env.telemetry`; the generated password is
URL-safe. Then build and restart the API using its normal deployment process:

```bash
pnpm install --frozen-lockfile
pnpm run build
```

The real public URL stays `https://api.euphoriadevelopment.uk/telemetry/panel`.
Existing opt-in panels will populate the dashboard on their next daily report.
When the database URL is blank, the API preserves its Redis-only receiver.
When PostgreSQL is configured but unavailable, submissions return 503 rather
than falsely claiming a historical report was accepted.

If the API runs inside a Pterodactyl/Wings container, `127.0.0.1` refers to that
container. Join that API container to the stack's private network instead:

```bash
docker network connect euphoria-telemetry_default YOUR_API_CONTAINER
```

Use `postgres:5432` in its database URL. Attach this private network again if
Wings replaces that container. Do not publish PostgreSQL to all interfaces.

## Bring over existing Redis reports

After configuring both `REDIS_URL` and `TELEMETRY_DATABASE_URL` in the real API's
`.env`, run from that checkout:

```bash
pnpm telemetry:import
```

The importer scans telemetry keys, validates and copies the existing latest
reports with their original received timestamps, and preserves all Redis keys.
Repeat runs are safe. It cannot reconstruct reports overwritten before history
storage was added. Invalid records are skipped; storage failures stop the import.

## Data and access

- Latest reports and daily snapshots are retained for 90 complete UTC days by
  default. Set `TELEMETRY_RETENTION_DAYS` to 1–3650 in the real API environment;
  cleanup runs at API startup and once every 24 hours while it is running.
- Repeated reports update the same installation/day; older reports cannot
  replace newer ones. Latest and daily writes commit in one transaction.
- Reports are limited to 32 KiB and four requests per IP per hour. Validation
  accepts bounded version/driver strings, canonical UUIDs, booleans, and
  nonnegative integer counts up to one billion. Unknown fields, client-supplied
  timestamps, and extra identity/credential data are never persisted.
- Legacy reports without optional fields remain accepted; missing resource
  counts are stored as null rather than invented zeros.
- `telemetry_ingest` can write the telemetry tables. `telemetry_reader` can
  select only reporting views and cannot write data or access base tables.
- Metabase stores its accounts and dashboard configuration in a separate
  database owned by `metabase_app`; its telemetry connection uses the reader.
- PostgreSQL data survives container recreation in the `telemetry-data` volume.
  Back up both the `telemetry` and `metabase` databases and the private
  `.env.telemetry` file, including its encryption key. Removing the volume
  deletes those databases.

The PostgreSQL initialization creates the schema and roles on a new volume.
For subsequent schema/role migrations, run the idempotent initializer explicitly
against the existing database:

```bash
docker compose --env-file .env.telemetry -f compose.telemetry.yaml exec -T postgres sh /telemetry/init-database.sh
```

Changing passwords in the environment alone does not rotate existing database
roles. Apply the initializer and update the Metabase data connection when
rotating its reader password. The setup command never resets an existing
administrator's password.

## Validation

```bash
pnpm run types:telemetry
pnpm run test:telemetry
pnpm run test:telemetry:integration
pnpm run build
```

The integration command reads the local stack configuration, creates a randomly
named `telemetry_qa_*` database, tests actual transactions, deduplication,
retention, and permissions, then removes only that test database. It does not
clear the dashboard's reporting database.
It also starts a disposable Redis container to check the optional import and
removes that container when the checks finish.
