import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { AppErrorBoundary } from "../../../app/components/AppErrorBoundary";

function DeliberateRenderFailure(): never {
  throw new Error("DES-17 deliberate rendered regression failure");
}

export function mountDes17BoundaryProbe() {
  const host = document.createElement("div");
  host.dataset.des17BoundaryProbe = "true";
  document.body.append(host);
  createRoot(host).render(createElement(
    AppErrorBoundary,
    null,
    createElement(DeliberateRenderFailure),
  ));
}
