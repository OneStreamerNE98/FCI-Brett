import { NextRequest, NextResponse } from "next/server";
import { normalizeGmailBucket, normalizeGmailSearch } from "../../../../../../lib/google-gmail";
import { requireOfficeUser } from "../../../../../../lib/workspace-auth";
import { getTestGmailClient, gmailErrorResponse } from "../_route-helpers";

export async function GET(request: NextRequest) {
  const auth = requireOfficeUser(request, { admin: true });
  if ("response" in auth) return auth.response;

  try {
    const { client } = await getTestGmailClient();
    const bucket = normalizeGmailBucket(request.nextUrl.searchParams.get("label"));
    const search = normalizeGmailSearch(request.nextUrl.searchParams.get("q"));
    const labelId = await client.labelIdForBucket(bucket);
    if (!labelId) {
      return NextResponse.json(
        { bucket, messages: [], labelReady: false, limit: 20 },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    const messages = await client.listMessages({ labelId, search });
    return NextResponse.json(
      { bucket, messages, labelReady: true, limit: 20 },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return gmailErrorResponse(error);
  }
}
