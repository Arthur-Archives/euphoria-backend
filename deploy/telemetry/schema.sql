BEGIN;
CREATE SCHEMA IF NOT EXISTS telemetry;
CREATE TABLE IF NOT EXISTS telemetry.panel_latest (
    instance_id uuid PRIMARY KEY,
    received_at timestamptz NOT NULL,
    panel_version varchar(64) NOT NULL,
    php_version varchar(32) NOT NULL,
    database_driver varchar(32) NOT NULL,
    cache_driver varchar(32),
    queue_driver varchar(32),
    docker boolean,
    user_count bigint CHECK (user_count BETWEEN 0 AND 1000000000),
    server_count bigint CHECK (server_count BETWEEN 0 AND 1000000000),
    node_count bigint CHECK (node_count BETWEEN 0 AND 1000000000)
);
CREATE INDEX IF NOT EXISTS panel_latest_received_at ON telemetry.panel_latest (received_at);
CREATE TABLE IF NOT EXISTS telemetry.panel_daily (
    instance_id uuid NOT NULL,
    snapshot_date date NOT NULL,
    received_at timestamptz NOT NULL,
    panel_version varchar(64) NOT NULL,
    php_version varchar(32) NOT NULL,
    database_driver varchar(32) NOT NULL,
    cache_driver varchar(32),
    queue_driver varchar(32),
    docker boolean,
    user_count bigint CHECK (user_count BETWEEN 0 AND 1000000000),
    server_count bigint CHECK (server_count BETWEEN 0 AND 1000000000),
    node_count bigint CHECK (node_count BETWEEN 0 AND 1000000000),
    PRIMARY KEY (instance_id, snapshot_date)
);
CREATE INDEX IF NOT EXISTS panel_daily_date ON telemetry.panel_daily (snapshot_date);
CREATE OR REPLACE VIEW telemetry.latest_reports AS SELECT * FROM telemetry.panel_latest;
CREATE OR REPLACE VIEW telemetry.daily_reports AS SELECT * FROM telemetry.panel_daily;
CREATE OR REPLACE VIEW telemetry.daily_totals AS
SELECT snapshot_date, count(*) AS reporting_installations,
    coalesce(sum(user_count), 0) AS reported_users,
    coalesce(sum(server_count), 0) AS reported_servers,
    coalesce(sum(node_count), 0) AS reported_nodes,
    count(*) FILTER (WHERE docker) AS docker_installations
FROM telemetry.panel_daily GROUP BY snapshot_date;
COMMIT;
