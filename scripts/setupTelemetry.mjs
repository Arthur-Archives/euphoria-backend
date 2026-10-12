import { randomUUID } from "node:crypto";

const base = process.env.METABASE_URL || "http://localhost:3013";
const email = process.env.METABASE_ADMIN_EMAIL;
const password = process.env.METABASE_ADMIN_PASSWORD;
if (!email || !password || !process.env.TELEMETRY_READER_PASSWORD) {
  throw new Error(
    "Run this setup through compose.telemetry.yaml with .env.telemetry.",
  );
}
let session;
async function api(method, endpoint, body) {
  const response = await fetch(`${base}/api${endpoint}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(session ? { "X-Metabase-Session": session } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) {
    // API error bodies may contain connection details; do not print credentials.
    throw new Error(
      `Metabase ${method} ${endpoint} failed (HTTP ${response.status}).`,
    );
  }
  return response.status === 204 ? undefined : response.json();
}

const description =
  "Anonymous, opt-in, self-reported Aquadactyl installation statistics. Overview and version charts include installations seen in the last 7 days. History contains one latest report per installation per UTC day; it starts when PostgreSQL storage is enabled.";
const active =
  "FROM telemetry.latest_reports WHERE received_at >= now() - interval '7 days'";
const history =
  "WHERE snapshot_date >= CURRENT_DATE - (LEAST(GREATEST({{days}}, 1), 3650) - 1)";
const specifications = [
  {
    name: "Reporting installations · 7 days",
    display: "scalar",
    query: `SELECT count(*) AS "Installations" ${active}`,
    row: 0,
    col: 0,
    width: 6,
    height: 4,
  },
  {
    name: "Reported servers · 7 days",
    display: "scalar",
    query: `SELECT coalesce(sum(server_count), 0) AS "Servers" ${active}`,
    row: 0,
    col: 6,
    width: 6,
    height: 4,
  },
  {
    name: "Reported users · 7 days",
    display: "scalar",
    query: `SELECT coalesce(sum(user_count), 0) AS "Users" ${active}`,
    row: 0,
    col: 12,
    width: 6,
    height: 4,
  },
  {
    name: "Reported nodes · 7 days",
    display: "scalar",
    query: `SELECT coalesce(sum(node_count), 0) AS "Nodes" ${active}`,
    row: 0,
    col: 18,
    width: 6,
    height: 4,
  },
  {
    name: "Daily reporting installations",
    display: "line",
    query: `SELECT snapshot_date AS "Day", reporting_installations AS "Installations" FROM telemetry.daily_totals ${history} ORDER BY snapshot_date`,
    history: true,
    row: 4,
    col: 0,
    width: 12,
    height: 8,
    settings: {
      "graph.dimensions": ["Day"],
      "graph.metrics": ["Installations"],
      "graph.colors": ["#237c7f"],
    },
  },
  {
    name: "Daily reported resources",
    display: "line",
    query: `SELECT snapshot_date AS "Day", reported_servers AS "Servers", reported_users AS "Users", reported_nodes AS "Nodes" FROM telemetry.daily_totals ${history} ORDER BY snapshot_date`,
    history: true,
    row: 4,
    col: 12,
    width: 12,
    height: 8,
    settings: {
      "graph.dimensions": ["Day"],
      "graph.metrics": ["Servers", "Users", "Nodes"],
      "graph.colors": ["#237c7f", "#7c3aed", "#2563eb"],
    },
  },
  {
    name: "Panel versions · 7 days",
    display: "bar",
    query: `SELECT panel_version AS "Version", count(*) AS "Installations" ${active} GROUP BY panel_version ORDER BY count(*) DESC`,
    row: 12,
    col: 0,
    width: 8,
    height: 8,
  },
  {
    name: "PHP versions · 7 days",
    display: "bar",
    query: `SELECT php_version AS "Version", count(*) AS "Installations" ${active} GROUP BY php_version ORDER BY count(*) DESC`,
    row: 12,
    col: 8,
    width: 8,
    height: 8,
  },
  {
    name: "Docker usage · 7 days",
    display: "pie",
    query: `SELECT CASE WHEN docker THEN 'Docker' WHEN docker = false THEN 'Other' ELSE 'Unknown' END AS "Environment", count(*) AS "Installations" ${active} GROUP BY docker`,
    row: 12,
    col: 16,
    width: 8,
    height: 8,
    settings: { "pie.dimension": "Environment", "pie.metric": "Installations" },
  },
  {
    name: "Latest contact · latest 1,000 installations",
    display: "table",
    query:
      'SELECT instance_id AS "Installation ID", received_at AS "Last contact (UTC)", panel_version AS "Panel version", php_version AS "PHP version", server_count AS "Servers", user_count AS "Users", node_count AS "Nodes", docker AS "Docker" FROM telemetry.latest_reports ORDER BY received_at DESC LIMIT 1000',
    row: 20,
    col: 0,
    width: 24,
    height: 10,
  },
];

async function setup() {
  const properties = await api("GET", "/session/properties");
  if (properties["setup-token"]) {
    await api("POST", "/setup", {
      token: properties["setup-token"],
      user: { email, password, first_name: "Aquadactyl", last_name: "Admin" },
      prefs: { site_name: "Aquadactyl Telemetry", allow_tracking: false },
    });
  }
  session = (await api("POST", "/session", { username: email, password })).id;
  try {
    const databases = await api("GET", "/database");
    let database = (databases.data || databases).find(
      (item) => item.name === "Aquadactyl Telemetry",
    );
    if (!database) {
      database = await api("POST", "/database", {
        name: "Aquadactyl Telemetry",
        engine: "postgres",
        details: {
          host: process.env.TELEMETRY_DATABASE_HOST || "postgres",
          port: 5432,
          dbname: "telemetry",
          user: "telemetry_reader",
          password: process.env.TELEMETRY_READER_PASSWORD,
          ssl: false,
          "schema-filters-type": "inclusion",
          "schema-filters-patterns": "telemetry",
        },
        is_full_sync: true,
        is_on_demand: false,
      });
    }
    const collections = await api("GET", "/collection");
    let collection = collections.find(
      (item) => item.name === "Aquadactyl Telemetry" && !item.archived,
    );
    if (!collection)
      collection = await api("POST", "/collection", {
        name: "Aquadactyl Telemetry",
        description,
        color: "#237c7f",
      });

    // Restrict this collection to administrators. Preserve other collections.
    const graph = await api("GET", "/collection/graph");
    const groups = await api("GET", "/permissions/group");
    for (const [groupId, permissions] of Object.entries(graph.groups)) {
      permissions[collection.id] =
        groups.find((group) => String(group.id) === groupId)?.name ===
        "Administrators"
          ? "write"
          : "none";
    }
    await api("PUT", "/collection/graph", graph);
    // The OSS edition uses collection access plus Create queries permissions.
    // Disable ad-hoc queries into this datasource for non-administrator groups.
    const dataGraph = await api("GET", "/permissions/graph");
    for (const [groupId, databases] of Object.entries(dataGraph.groups)) {
      const group = groups.find((group) => String(group.id) === groupId);
      if (group && group.name !== "Administrators") {
        databases[database.id] = {
          ...databases[database.id],
          "create-queries": "no",
        };
      }
    }
    await api("PUT", "/permissions/graph", dataGraph);

    const contents = await api("GET", `/collection/${collection.id}/items`);
    let dashboard = contents.data.find(
      (item) =>
        item.model === "dashboard" &&
        item.name === "Aquadactyl telemetry overview",
    );
    if (dashboard) {
      const existing = await api("GET", `/dashboard/${dashboard.id}`);
      if (existing.dashcards.length > 0) {
        console.log(
          `Dashboard already exists; customizations preserved: ${process.env.METABASE_SITE_URL || base}/dashboard/${dashboard.id}`,
        );
        return;
      }
    }
    dashboard ??= await api("POST", "/dashboard", {
      name: "Aquadactyl telemetry overview",
      description,
      collection_id: collection.id,
    });
    const cards = [];
    for (const specification of specifications) {
      const tags = specification.history
        ? {
            days: {
              id: randomUUID(),
              name: "days",
              "display-name": "History (days)",
              type: "number",
              default: 90,
              required: true,
            },
          }
        : {};
      let card = contents.data.find(
        (item) => item.model === "card" && item.name === specification.name,
      );
      if (!card)
        card = await api("POST", "/card", {
          name: specification.name,
          description,
          collection_id: collection.id,
          display: specification.display,
          visualization_settings: specification.settings || {},
          dataset_query: {
            database: database.id,
            type: "native",
            native: { query: specification.query, "template-tags": tags },
          },
        });
      cards.push({
        id: -cards.length - 1,
        card_id: card.id,
        row: specification.row,
        col: specification.col,
        size_x: specification.width,
        size_y: specification.height,
        series: [],
        visualization_settings: {},
        parameter_mappings: specification.history
          ? [
              {
                parameter_id: "history-days",
                card_id: card.id,
                target: ["variable", ["template-tag", "days"]],
              },
            ]
          : [],
      });
    }
    await api("PUT", `/dashboard/${dashboard.id}`, {
      dashcards: cards,
      parameters: [
        {
          id: "history-days",
          name: "History (days)",
          slug: "history_days",
          type: "number/=",
          default: "90",
        },
      ],
    });
    console.log(
      `Private telemetry dashboard ready: ${process.env.METABASE_SITE_URL || base}/dashboard/${dashboard.id}`,
    );
  } finally {
    await api("DELETE", "/session", { session_id: session });
    session = undefined;
  }
}

setup().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
