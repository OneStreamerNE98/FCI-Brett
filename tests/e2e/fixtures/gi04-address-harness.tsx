import { useState, type FormEvent } from "react";
import { createRoot, type Root } from "react-dom/client";

import { AddressValidationField } from "../../../app/features/address-validation/AddressValidationField";
import type { JobSiteMapsRuntimeConfig } from "../../../app/features/maps/job-site-map";

type HarnessHandle = Readonly<{
  root: Root;
  host: HTMLDivElement;
}>;

const browserGlobal = globalThis as typeof globalThis & {
  __GI04_ADDRESS_HARNESS__?: HarnessHandle;
};

export function unmountAddressValidationHarness() {
  const current = browserGlobal.__GI04_ADDRESS_HARNESS__;
  if (!current) return;
  current.root.unmount();
  current.host.remove();
  delete browserGlobal.__GI04_ADDRESS_HARNESS__;
}

export function mountAddressValidationHarness(
  mapsRuntime: JobSiteMapsRuntimeConfig,
) {
  unmountAddressValidationHarness();
  const host = document.createElement("div");
  host.id = "gi04-address-harness";
  host.dataset.submits = "0";
  Object.assign(host.style, {
    position: "fixed",
    inset: "12px 12px auto auto",
    zIndex: "1000000",
    width: "min(520px, calc(100vw - 24px))",
    padding: "16px",
    background: "white",
  });
  document.body.append(host);
  const root = createRoot(host);

  function Harness() {
    const [value, setValue] = useState("");
    function submit(event: FormEvent<HTMLFormElement>) {
      event.preventDefault();
      host.dataset.submits = String(Number(host.dataset.submits ?? "0") + 1);
    }
    return <form onSubmit={submit}>
      <AddressValidationField
        id="gi04-harness-address"
        name="site"
        label="Harness site"
        value={value}
        entityKind="project"
        targetId="new"
        mapsRuntime={mapsRuntime}
        onChange={setValue}
        onReviewChange={() => undefined}
      />
      <button type="submit">Harness save</button>
    </form>;
  }

  root.render(<Harness />);
  browserGlobal.__GI04_ADDRESS_HARNESS__ = { root, host };
}
