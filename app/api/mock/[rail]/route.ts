import { actions, uuid } from "@/src/lib/contracts";
import { apiError, ApiError, gateway } from "@/src/lib/server";

export async function GET(request: Request, context: RouteContext<"/api/mock/[rail]">) {
  try {
    const { rail } = await context.params;
    const query = new URL(request.url).searchParams;
    if (rail === "scheme") return Response.json(await gateway("scheme"));
    if (rail === "nadra") {
      const parsed = uuid.nullable().safeParse(query.get("citizenId"));
      if (!parsed.success) throw new ApiError(400, "Invalid synthetic citizen ID.");
      return Response.json(await gateway("nadra", { citizenId: parsed.data }));
    }
    if (rail === "raast") {
      const parsed = actions.raast.safeParse({ reference: query.get("reference") });
      if (!parsed.success) throw new ApiError(400, "Enter a mock receipt reference.");
      return Response.json(await gateway("raast", parsed.data));
    }
    throw new ApiError(404, "Unknown simulated rail.");
  } catch (error) {
    return apiError(error);
  }
}
