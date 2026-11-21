export function GET() {
  return Response.json({ status: "ok", service: "relief-claim-assist" }, {
    headers: { "Cache-Control": "no-store" },
  });
}
