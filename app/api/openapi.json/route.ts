export function GET() {
  return Response.json({
    openapi: "3.1.0",
    info: { title: "Relief Claim Assist", version: "1.0.0", description: "Synthetic public rails prototype." },
    paths: {
      "/api/v1/scheme": {
        get: {
          summary: "Read the active simulated relief policy configuration",
          security: [{ PartnerKey: [] }],
          responses: {
            200: { description: "Current rules",
              content: { "application/json": { schema: { type: "object", properties: {
                scheme: { type: "string" }, version: { type: "integer" },
                rules: { type: "object" }, simulated: { const: true },
              } } } } },
            401: { description: "Missing or invalid key" }, 403: { description: "Missing scheme:read scope" },
            502: { description: "Registry unavailable" },
          },
        },
      },
    },
    components: { securitySchemes: { PartnerKey: { type: "apiKey", in: "header", name: "x-api-key" } } },
  });
}
