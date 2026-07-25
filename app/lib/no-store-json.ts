import { NextResponse } from "next/server";

export function noStoreResponse<T extends Response>(response: T) {
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export function noStoreJson(body: unknown, init: ResponseInit | number = {}) {
  return noStoreResponse(NextResponse.json(
    body,
    typeof init === "number" ? { status: init } : init,
  ));
}
