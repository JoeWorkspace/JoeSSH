import { useEffect, useRef } from "react";
import { getActiveElement } from "./dom-utils";

const FOCUSABLE_SELECTORS = [
  'a[href]:not([tabindex="-1"])',
  'button:not([disabled]):not([tabindex="-1"])',
  'input:not([disabled]):not([tabindex="-1"])',
  'select:not([disabled]):not([tabindex="-1"])',
  'textarea:not([disabled]):not([tabindex="-1"])',
  "[tabindex]:not([tabindex=\"-1\"])",
].join(", ");

const PREFERRED_FOCUS_SELECTOR = "[data-autofocus]:not([disabled])";

/**
 * Traps keyboard focus within the referenced element while active.
 * Returns a ref to attach to the container element.
 */
export function useFocusTrap<T extends HTMLElement>(active: boolean) {
  const ref = useRef<T>(null);

  useEffect(() => {
    if (!active || !ref.current) return;

    const container = ref.current;
    const previousActiveElement = getActiveElement();

    function getFocusableElements(): HTMLElement[] {
      return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTORS));
    }

    // Capture the opener before moving focus. Consumers use data-autofocus
    // instead of React's autoFocus so this still points at the invoking control.
    const focusable = getFocusableElements();
    const preferred = container.querySelector<HTMLElement>(
      PREFERRED_FOCUS_SELECTOR,
    );
    if (preferred) {
      preferred.focus();
    } else if (focusable.length > 0) {
      focusable[0].focus();
    } else if (container.hasAttribute("tabindex")) {
      container.focus();
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Tab") return;

      const elements = getFocusableElements();
      if (elements.length === 0) return;

      const first = elements[0];
      const last = elements[elements.length - 1];
      const active = getActiveElement();

      if (event.shiftKey) {
        if (active === first) {
          event.preventDefault();
          last.focus();
        }
      } else {
        if (active === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }

    container.addEventListener("keydown", handleKeyDown);

    return () => {
      container.removeEventListener("keydown", handleKeyDown);
      // Restore focus to the previously active element
      if (
        previousActiveElement &&
        previousActiveElement.isConnected &&
        typeof previousActiveElement.focus === "function"
      ) {
        previousActiveElement.focus();
      }
    };
  }, [active]);

  return ref;
}
