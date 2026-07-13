export function tabBoundaryTarget<T>(
  activeElement: T | null,
  focusableElements: readonly T[],
  shiftKey: boolean,
  activeElementIsInside: boolean,
): T | null {
  if (focusableElements.length === 0) return null;

  const first = focusableElements[0];
  const last = focusableElements[focusableElements.length - 1];
  if (!activeElementIsInside) return shiftKey ? last : first;
  if (shiftKey && activeElement === first) return last;
  if (!shiftKey && activeElement === last) return first;
  return null;
}
