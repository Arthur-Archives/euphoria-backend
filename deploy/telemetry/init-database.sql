\set ON_ERROR_STOP on
\getenv writer_password TELEMETRY_WRITER_PASSWORD
\getenv reader_password TELEMETRY_READER_PASSWORD
\getenv metabase_password METABASE_DB_PASSWORD
SELECT 'CREATE ROLE telemetry_ingest LOGIN' WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'telemetry_ingest') \gexec
SELECT 'CREATE ROLE telemetry_reader LOGIN' WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'telemetry_reader') \gexec
SELECT 'CREATE ROLE metabase_app LOGIN' WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'metabase_app') \gexec
SELECT format('ALTER ROLE telemetry_ingest PASSWORD %L', :'writer_password') \gexec
SELECT format('ALTER ROLE telemetry_reader PASSWORD %L', :'reader_password') \gexec
SELECT format('ALTER ROLE metabase_app PASSWORD %L', :'metabase_password') \gexec
ALTER ROLE telemetry_reader SET default_transaction_read_only = on;
ALTER ROLE telemetry_reader SET statement_timeout = '15s';
SELECT 'CREATE DATABASE metabase OWNER metabase_app' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'metabase') \gexec
REVOKE ALL ON DATABASE metabase FROM PUBLIC;
GRANT CONNECT ON DATABASE metabase TO metabase_app;
\i /telemetry/schema.sql
REVOKE ALL ON DATABASE telemetry FROM PUBLIC;
GRANT CONNECT ON DATABASE telemetry TO telemetry_ingest, telemetry_reader;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON SCHEMA telemetry FROM PUBLIC;
GRANT USAGE ON SCHEMA telemetry TO telemetry_ingest, telemetry_reader;
GRANT SELECT, INSERT, UPDATE, DELETE ON telemetry.panel_latest, telemetry.panel_daily TO telemetry_ingest;
GRANT SELECT ON telemetry.latest_reports, telemetry.daily_reports, telemetry.daily_totals TO telemetry_reader;
