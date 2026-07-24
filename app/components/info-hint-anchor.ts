export const INFO_HINT_ANCHORS = ["left", "right", "auto"] as const;

export type InfoHintAnchor = (typeof INFO_HINT_ANCHORS)[number];
export type ResolvedInfoHintAnchor = Exclude<InfoHintAnchor, "auto">;

type TriggerBounds = Readonly<{
  left: number;
  right: number;
}>;

export function resolveInfoHintAnchor(
  anchor: InfoHintAnchor,
  triggerBounds?: TriggerBounds,
  viewportWidth?: number,
): ResolvedInfoHintAnchor {
  if (anchor !== "auto") return anchor;
  if (!triggerBounds || typeof viewportWidth !== "number" || !Number.isFinite(viewportWidth) || viewportWidth <= 0) {
    return "right";
  }

  const roomToTheRight = viewportWidth - triggerBounds.left;
  const roomToTheLeft = triggerBounds.right;
  return roomToTheRight >= roomToTheLeft ? "left" : "right";
}
