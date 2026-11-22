import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { suggestHost } from "@/lib/yandex/links";
import { listHosts, yandexErrorResponse } from "@/lib/yandex/routes";

/** The Webmaster hosts of the user's Yandex account, read live; ?domain= marks the one that matches. */
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const hosts = await listHosts(db, session.user.id);
    const domain = new URL(req.url).searchParams.get("domain");
    return Response.json({ hosts, suggested: domain ? (suggestHost(hosts, domain)?.hostId ?? null) : null });
  } catch (error) {
    const known = yandexErrorResponse(error);
    if (known) return known;
    console.error("Yandex hosts error:", error);
    return Response.json({ error: "Failed to load Webmaster hosts" }, { status: 500 });
  }
}
