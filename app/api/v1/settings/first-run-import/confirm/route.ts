import { NextRequest } from "next/server";

import { handleFirstRunImportConfirm } from "../_shared";
import { noStoreResponse } from "../../../../../lib/no-store-json";
import { requireOfficeUser, requireSameOrigin } from "../../../../../lib/workspace-auth";

export async function POST(request: NextRequest) {
  const originError = requireSameOrigin(request);
  if (originError) return noStoreResponse(originError);
  const auth = requireOfficeUser(request, { admin: true });
  if ("response" in auth) return noStoreResponse(auth.response);
  return handleFirstRunImportConfirm(request, auth.user.email);
}
