import { handleApiV1 } from "@/lib/api-v1/router";

// The API (lib/api-v1/router.ts): GET everywhere, and POST to
// /sites/{siteId}/positions with a write-scoped key (agency fork). Other
// methods get 405 from Next.
export const dynamic = "force-dynamic";

export function GET(req: Request): Promise<Response> {
  return handleApiV1(req);
}

export function POST(req: Request): Promise<Response> {
  return handleApiV1(req);
}
