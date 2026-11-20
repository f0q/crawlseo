import { handleApiV1 } from "@/lib/api-v1/router";

// The API (lib/api-v1/router.ts): GET everywhere, and POST to
// /sites/{siteId}/positions with a write-scoped key (agency fork), and POST
// and PATCH under /projects (agency fork, lib/projects). Other methods get
// 405 from Next.
export const dynamic = "force-dynamic";

export function GET(req: Request): Promise<Response> {
  return handleApiV1(req);
}

export function POST(req: Request): Promise<Response> {
  return handleApiV1(req);
}

export function PATCH(req: Request): Promise<Response> {
  return handleApiV1(req);
}
