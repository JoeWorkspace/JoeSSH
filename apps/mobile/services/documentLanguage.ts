import type { AtlasLocale } from "@atlasterm/i18n";

type DocumentElementLike = {
  getAttribute(name: string): string | null;
  removeAttribute(name: string): void;
  setAttribute(name: string, value: string): void;
};

export function applyWebDocumentLanguage(
  locale: AtlasLocale,
  documentElement = getWebDocumentElement(),
) {
  if (!documentElement) {
    return () => undefined;
  }

  const previousLanguage = documentElement.getAttribute("lang");
  documentElement.setAttribute("lang", locale);

  return () => {
    if (previousLanguage === null) {
      documentElement.removeAttribute("lang");
    } else {
      documentElement.setAttribute("lang", previousLanguage);
    }
  };
}

function getWebDocumentElement(): DocumentElementLike | undefined {
  return (
    globalThis as {
      document?: {
        documentElement?: DocumentElementLike;
      };
    }
  ).document?.documentElement;
}
