import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  connectWithCode,
  disconnectYandex,
  yandexStatus,
  YandexNotConfiguredError,
} from "@/lib/yandex/connection";
import { YANDEX_UI } from "@/lib/yandex/messages";
import { normalizeCode, yandexAuthorizeUrl, yandexCredentials, YandexOAuthError } from "@/lib/yandex/oauth";

/*
 * The signed-in user's Yandex connection (agency fork).
 * GET     status, and the authorize URL that "Connect" opens
 * POST    { code }: exchanges the confirmation code Yandex showed and stores the tokens
 * DELETE  revokes and removes the token, unlinks every site and deletes the synced data
 */

async function userId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ?? null;
}

const unauthorized = () => Response.json({ error: "Unauthorized" }, { status: 401 });

export async function GET() {
  const id = await userId();
  if (!id) return unauthorized();
  const creds = yandexCredentials();
  return Response.json({ ...(await yandexStatus(db, id)), authorizeUrl: creds ? yandexAuthorizeUrl(creds.clientId) : null });
}

export async function POST(req: Request) {
  const id = await userId();
  if (!id) return unauthorized();
  const body = (await req.json().catch(() => null)) as { code?: unknown } | null;
  const code = normalizeCode(body?.code);
  if (!code) return Response.json({ error: YANDEX_UI.errors.badCode }, { status: 400 });
  try {
    return Response.json(await connectWithCode(db, id, code), { status: 201 });
  } catch (error) {
    if (error instanceof YandexNotConfiguredError) return Response.json({ error: error.message }, { status: 503 });
    if (error instanceof YandexOAuthError) {
      return Response.json({ error: YANDEX_UI.errors.codeRefused(error.code), code: error.code }, { status: 400 });
    }
    console.error("Yandex connect error:", error instanceof Error ? error.message : error);
    return Response.json({ error: "Yandex did not answer. Try again." }, { status: 502 });
  }
}

export async function DELETE() {
  const id = await userId();
  if (!id) return unauthorized();
  try {
    await disconnectYandex(db, id);
    return Response.json({ success: true });
  } catch (error) {
    console.error("Yandex disconnect error:", error);
    return Response.json({ error: "Failed to disconnect Yandex" }, { status: 500 });
  }
}
