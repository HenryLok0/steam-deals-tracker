const ALLOWED_TAGS = new Set([
  "p",
  "br",
  "strong",
  "b",
  "em",
  "i",
  "ul",
  "ol",
  "li",
  "h1",
  "h2",
  "h3",
  "span",
  "div",
  "a",
  "img",
]);

const GLOBAL_ATTRS = new Set(["class", "title"]);
const TAG_ATTRS = {
  a: new Set(["href", "target", "rel"]),
  img: new Set(["src", "alt", "width", "height"]),
};

function isSafeUrl(value, tagName) {
  if (!value) return false;
  const trimmed = value.trim().toLowerCase();
  if (trimmed.startsWith("#")) return true;
  if (tagName === "a") {
    return (
      trimmed.startsWith("https://") ||
      trimmed.startsWith("http://") ||
      trimmed.startsWith("mailto:")
    );
  }
  if (tagName === "img") {
    return trimmed.startsWith("https://") || trimmed.startsWith("http://");
  }
  return false;
}

function cleanNode(node) {
  let child = node.firstChild;
  while (child) {
    const next = child.nextSibling;

    if (child.nodeType === Node.TEXT_NODE) {
      child = next;
      continue;
    }

    if (child.nodeType !== Node.ELEMENT_NODE) {
      child.remove();
      child = next;
      continue;
    }

    const tagName = child.tagName.toLowerCase();
    if (!ALLOWED_TAGS.has(tagName)) {
      while (child.firstChild) {
        node.insertBefore(child.firstChild, child);
      }
      child.remove();
      child = next;
      continue;
    }

    [...child.attributes].forEach((attr) => {
      const allowed =
        GLOBAL_ATTRS.has(attr.name) || TAG_ATTRS[tagName]?.has(attr.name);
      if (!allowed) {
        child.removeAttribute(attr.name);
        return;
      }
      if ((tagName === "a" || tagName === "img") && !isSafeUrl(attr.value, tagName)) {
        child.removeAttribute(attr.name);
      }
    });

    if (tagName === "a") {
      child.setAttribute("target", "_blank");
      child.setAttribute("rel", "noreferrer noopener");
    }

    cleanNode(child);
    child = next;
  }
}

export function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function sanitizeHtml(rawHtml) {
  if (!rawHtml) return "";

  const doc = new DOMParser().parseFromString(String(rawHtml), "text/html");
  cleanNode(doc.body);
  return doc.body.innerHTML.trim();
}

export function plainTextToHtml(text) {
  if (!text) return "";
  return `<p>${escapeHtml(text).replace(/\n+/g, "<br>")}</p>`;
}
