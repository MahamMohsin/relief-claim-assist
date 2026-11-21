import { uuid } from "@/src/lib/contracts";
import { apiError, ApiError, gateway } from "@/src/lib/server";

export async function GET(_request: Request, context: RouteContext<"/api/relief/profile-file/[id]">) {
  try {
    const { id } = await context.params;
    if (!uuid.safeParse(id).success) throw new ApiError(404, "Unknown profile document.");
    const { image } = await gateway<{ image: string }>("citizen_doc_file", { documentId: id });
    const parsed = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(image);
    if (!parsed) throw new ApiError(404, "No viewable image is attached.");
    return new Response(Uint8Array.from(Buffer.from(parsed[2], "base64")).buffer, {
      headers: {
        "Content-Type": parsed[1],
        "Cache-Control": "private, no-store",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
