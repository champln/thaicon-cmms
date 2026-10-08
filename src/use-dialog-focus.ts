import { useEffect, useRef } from "react";

/** Keep keyboard focus inside an open dialog and return it to its launcher. */
export function useDialogFocus<T extends HTMLElement>(onClose: () => void) {
  const element = useRef<T>(null);
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; }, [onClose]);
  useEffect(() => {
    const dialog = element.current;
    if (!dialog) return;
    const previous = document.activeElement;
    const controls = () => Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]'))
      .filter(control => !control.closest('[inert]') && control.getClientRects().length > 0 && !control.matches(':disabled'));
    (controls()[0] ?? dialog).focus();
    function keydown(event: KeyboardEvent) {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close.current(); }
      if (event.key !== "Tab") return;
      const items = controls();
      if (!items.length) { event.preventDefault(); dialog!.focus(); return; }
      const first = items[0]; const last = items.at(-1)!;
      if (event.shiftKey && (document.activeElement === first || !dialog!.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !dialog!.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    }
    document.addEventListener("keydown", keydown, true);
    return () => {
      document.removeEventListener("keydown", keydown, true);
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  return element;
}
