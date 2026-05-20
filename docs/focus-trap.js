const FOCUSABLE =
  'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

export function trapFocus(container, onEscape) {
  const previous = document.activeElement;

  function getFocusable() {
    return [...container.querySelectorAll(FOCUSABLE)].filter(
      (node) => !node.hasAttribute("disabled") && node.offsetParent !== null,
    );
  }

  function handleKeyDown(event) {
    if (event.key === "Escape") {
      onEscape?.();
      return;
    }
    if (event.key !== "Tab") return;

    const nodes = getFocusable();
    if (!nodes.length) return;

    const first = nodes[0];
    const last = nodes[nodes.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  document.addEventListener("keydown", handleKeyDown);

  const nodes = getFocusable();
  (nodes[0] || container).focus();

  return () => {
    document.removeEventListener("keydown", handleKeyDown);
    if (previous && typeof previous.focus === "function") previous.focus();
  };
}
