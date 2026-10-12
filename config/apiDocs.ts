const CONTACT_EMAIL =
  process.env.API_CONTACT_EMAIL || "support@euphoriadevelopment.uk";
const API_TITLE = process.env.API_TITLE || "ED API";
const API_DESCRIPTION =
  process.env.API_DESCRIPTION ||
  "Public API for licensing, game server querying, translations, metadata, and RCON utilities.";
const API_VERSION = process.env.API_VERSION || "1.0.0";

export function createOpenApiDocument(baseUrl) {
  return {
    openapi: "3.1.0",
    info: {
      title: API_TITLE,
      version: API_VERSION,
      description: API_DESCRIPTION,
      contact: {
        email: CONTACT_EMAIL,
      },
    },
    servers: [
      {
        url: baseUrl,
      },
    ],
    tags: [
      { name: "System" },
      { name: "Stats" },
      { name: "License" },
      { name: "Games" },
      { name: "Translations" },
      { name: "Products" },
      { name: "Contributors" },
      { name: "Donators" },
      { name: "Versions" },
      { name: "RCON" },
      { name: "Telemetry" },
    ],
    paths: {
      "/": {
        get: {
          tags: ["System"],
          summary: "API entry point",
          responses: {
            200: {
              description: "Service metadata",
            },
          },
        },
      },
      "/health": {
        get: {
          tags: ["System"],
          summary: "Service health",
          responses: {
            200: {
              description: "Service is healthy",
            },
          },
        },
      },
      "/stats": {
        get: {
          tags: ["Stats"],
          summary: "Usage and blueprint stats",
          responses: {
            200: {
              description: "Current API stats",
            },
          },
        },
      },
      "/products": {
        get: {
          tags: ["Products"],
          summary: "List products",
          responses: {
            200: {
              description: "Products list",
            },
          },
        },
      },
      "/telemetry/panel": {
        post: {
          tags: ["Telemetry"],
          summary: "Receive opt-in Aquadactyl panel telemetry",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["schema", "instanceId", "panel"],
                  properties: {
                    schema: { type: "integer", enum: [1] },
                    instanceId: { type: "string", format: "uuid" },
                    panel: { type: "object" },
                    resources: { type: "object" },
                  },
                },
              },
            },
          },
          responses: {
            202: { description: "Telemetry accepted" },
            400: { description: "Invalid telemetry payload" },
            413: { description: "Payload too large" },
            429: { description: "Telemetry rate limit exceeded" },
            503: { description: "Telemetry storage unavailable" },
          },
        },
      },
      "/donators": {
        get: {
          tags: ["Donators"],
          summary: "List donators",
          responses: {
            200: {
              description: "Donators list",
            },
          },
        },
      },
      "/contributors": {
        get: {
          tags: ["Contributors"],
          summary: "List contributors",
          responses: {
            200: {
              description: "Contributors list",
            },
          },
        },
      },
      "/team": {
        get: {
          tags: ["Team"],
          summary: "List team members",
          responses: {
            200: {
              description: "Team members list",
            },
          },
        },
      },
      "/translations": {
        get: {
          tags: ["Translations"],
          summary: "List available translation languages",
          responses: {
            200: {
              description: "Languages list",
            },
          },
        },
      },
      "/translations/translate/bulk": {
        post: {
          tags: ["Translations"],
          summary: "Bulk translate keys/texts by language map",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["texts", "targetLang"],
                  properties: {
                    texts: {
                      type: "array",
                      items: { type: "string" },
                    },
                    targetLang: {
                      type: "string",
                      example: "de",
                    },
                  },
                },
              },
            },
          },
          responses: {
            200: {
              description: "Translated key-value map",
            },
          },
        },
      },
      "/gameapi": {
        get: {
          tags: ["Games"],
          summary: "List supported games",
          responses: {
            200: {
              description: "Games list",
            },
          },
        },
      },
      "/gameapi/{game}/ip={ip}&port={port}": {
        get: {
          tags: ["Games"],
          summary: "Query a game server by game id, host, and port",
          parameters: [
            {
              name: "game",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
            {
              name: "ip",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
            {
              name: "port",
              in: "path",
              required: true,
              schema: { type: "integer", minimum: 1, maximum: 65535 },
            },
          ],
          responses: {
            200: {
              description: "Server query result",
            },
          },
        },
      },
      "/license/verify-license": {
        post: {
          tags: ["License"],
          summary: "Verify license using v1 provider flow",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["licenseKey", "productId", "hwid"],
                  properties: {
                    licenseKey: { type: "string" },
                    productId: { type: "string" },
                    hwid: { type: "string" },
                  },
                },
              },
            },
          },
          responses: {
            200: {
              description: "License accepted",
            },
          },
        },
      },
      "/license/v2/verify-license": {
        post: {
          tags: ["License"],
          summary: "Verify license using v2 provider flow",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["licenseKey", "productId", "hwid"],
                  properties: {
                    licenseKey: { type: "string" },
                    productId: { type: "string" },
                    hwid: { type: "string" },
                    ip: {
                      type: "string",
                      description: "Optional; defaults to resolved client IP",
                    },
                  },
                },
              },
            },
          },
          responses: {
            200: {
              description: "License accepted",
            },
          },
        },
      },
      "/versions": {
        get: {
          tags: ["Versions"],
          summary: "Get versions list (requires license query params)",
          parameters: [
            {
              name: "auth",
              in: "query",
              required: true,
              schema: { type: "string" },
            },
            {
              name: "productId",
              in: "query",
              required: true,
              schema: { type: "string" },
            },
            {
              name: "hwid",
              in: "query",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            200: {
              description: "Versions list",
            },
          },
        },
      },
      "/rcon/health": {
        get: {
          tags: ["RCON"],
          summary: "RCON route health",
          responses: {
            200: {
              description: "RCON service health",
            },
          },
        },
      },
      "/rcon/variables": {
        post: {
          tags: ["RCON"],
          summary: "Execute RCON command and parse variable-like lines",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["host", "password", "port"],
                  properties: {
                    host: { type: "string" },
                    password: { type: "string" },
                    port: { type: "integer", minimum: 1, maximum: 65535 },
                    type: { type: "string", enum: ["source", "minecraft"] },
                    command: { type: "string" },
                  },
                },
              },
            },
          },
          responses: {
            200: {
              description: "RCON command result",
            },
          },
        },
      },
      "/rcon/players": {
        post: {
          tags: ["RCON"],
          summary: "Fetch and normalize online player data via RCON",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["host", "password", "port"],
                  properties: {
                    host: { type: "string" },
                    password: { type: "string" },
                    port: { type: "integer", minimum: 1, maximum: 65535 },
                    type: { type: "string", enum: ["source", "minecraft"] },
                    game: { type: "string" },
                    command: { type: "string" },
                    count_command: { type: "string" },
                    maxplayers_fallback: { type: "integer", minimum: 1 },
                  },
                },
              },
            },
          },
          responses: {
            200: {
              description: "Normalized player response",
            },
          },
        },
      },
    },
  };
}

export function renderScalarHtml({ specUrl, pageTitle = "ED API Docs" }) {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${pageTitle}</title>
  </head>
  <body>
    <script
      id="api-reference"
      data-url="${specUrl}"
      src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"
    ></script>
  </body>
</html>`;
}
