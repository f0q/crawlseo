import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { suggestCounter } from "@/lib/yandex/links";
import { listCounters, listGoals, yandexErrorResponse } from "@/lib/yandex/routes";

/**
 * The Metrika counters of the user's Yandex account, read live; ?domain=
 * marks the one that matches. With ?counterId= the goals of that counter.
 */
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const params = new URL(req.url).searchParams;
    const counterId = params.get("counterId");
    if (counterId) {
      if (!/^\d{1,20}$/.test(counterId)) return Response.json({ error: "counterId must be a number" }, { status: 400 });
      return Response.json({ goals: await listGoals(db, session.user.id, counterId) });
    }
    const counters = await listCounters(db, session.user.id);
    const domain = params.get("domain");
    return Response.json({ counters, suggested: domain ? (suggestCounter(counters, domain)?.id ?? null) : null });
  } catch (error) {
    const known = yandexErrorResponse(error);
    if (known) return known;
    console.error("Yandex counters error:", error);
    return Response.json({ error: "Failed to load Metrika counters" }, { status: 500 });
  }
}
