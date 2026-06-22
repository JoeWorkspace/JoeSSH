/** Returns the currently focused element, or null. */
export function getActiveElement(): HTMLElement | null {
  return document.activeElement as HTMLElement | null;
}
