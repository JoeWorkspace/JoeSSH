import { memo, type MouseEvent } from "react";
import { ScrollText, X } from "lucide-react";
import { Badge, IconButton, Panel } from "@atlasterm/ui";
import type { Translator } from "@atlasterm/i18n";
import { useFocusTrap } from "./useFocusTrap";

export const ThirdPartyNoticesOverlay = memo(function ThirdPartyNoticesOverlay({
  notices,
  onClose,
  t,
}: {
  notices: string;
  onClose: () => void;
  t: Translator;
}) {
  const focusTrapRef = useFocusTrap<HTMLDivElement>(true);

  return (
    <div
      className="palette-scrim third-party-notices-scrim"
      onClick={onClose}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <Panel
        aria-describedby="third-party-notices-description"
        aria-label={t("desktop.thirdPartyNotices")}
        aria-modal="true"
        className="third-party-notices-dialog"
        onClick={(event: MouseEvent) => event.stopPropagation()}
        ref={focusTrapRef}
        role="dialog"
        tabIndex={-1}
      >
        <header className="third-party-notices-header">
          <span className="third-party-notices-mark">
            <ScrollText aria-hidden="true" size={18} />
          </span>
          <div>
            <Badge>JoeSSH</Badge>
            <h2>{t("desktop.thirdPartyNotices")}</h2>
          </div>
          <IconButton label={t("desktop.close")} onClick={onClose}>
            <X size={16} />
          </IconButton>
        </header>
        <p id="third-party-notices-description">
          {t("desktop.thirdPartyNoticesHint")}
        </p>
        <pre className="third-party-notices-content" tabIndex={0}>
          {notices}
        </pre>
      </Panel>
    </div>
  );
});
