import { memo } from "react";
import {
  CircleHelp,
  Cloud,
  Info,
  Monitor,
  Plus,
  ShieldCheck,
  Smartphone,
  X,
} from "lucide-react";
import { Badge, Button, IconButton, Panel } from "@atlasterm/ui";
import type { Translator } from "@atlasterm/i18n";
import { useFocusTrap } from "./useFocusTrap";

export const GettingStartedOverlay = memo(function GettingStartedOverlay({
  desktopRuntime,
  onClose,
  onCreateConnection,
  showCompanionProductSurfaces = true,
  t,
}: {
  desktopRuntime: boolean;
  onClose: () => void;
  onCreateConnection: () => void;
  showCompanionProductSurfaces?: boolean;
  t: Translator;
}) {
  const focusTrapRef = useFocusTrap<HTMLDivElement>(true);

  return (
    <div
      className="palette-scrim getting-started-scrim"
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
        aria-label={t("desktop.gettingStarted")}
        aria-modal="true"
        className="getting-started-dialog"
        onClick={(event: React.MouseEvent) => event.stopPropagation()}
        ref={focusTrapRef}
        role="dialog"
      >
        <header className="getting-started-header">
          <span className="getting-started-mark">
            <CircleHelp size={20} aria-hidden="true" />
          </span>
          <div>
            <Badge>JoeSSH</Badge>
            <h2>{t("desktop.gettingStarted")}</h2>
          </div>
          <IconButton label={t("desktop.close")} onClick={onClose}>
            <X size={16} />
          </IconButton>
        </header>

        {showCompanionProductSurfaces ? (
          <p className="getting-started-summary">{t("desktop.surfaceGuide")}</p>
        ) : null}

        <div className="getting-started-surfaces">
          <section>
            <Monitor size={18} aria-hidden="true" />
            <div>
              <strong>{t("desktop.workspace")}</strong>
              <span>{t("desktop.noSessionActionDetail")}</span>
            </div>
          </section>
          {showCompanionProductSurfaces ? (
            <>
              <section>
                <Cloud size={18} aria-hidden="true" />
                <div>
                  <strong>{t("web.adminConsole")}</strong>
                  <span>{t("web.teamOverview")}</span>
                </div>
              </section>
              <section>
                <Smartphone size={18} aria-hidden="true" />
                <div>
                  <strong>{t("mobile.kicker")}</strong>
                  <span>{t("mobile.subtitle")}</span>
                </div>
              </section>
            </>
          ) : null}
        </div>

        <div className="getting-started-notes">
          <div>
            <Info size={17} aria-hidden="true" />
            <span>
              <strong>{t("desktop.sampleDataShort")}</strong>
              <small>{t("desktop.terminalSessionSample")}</small>
            </span>
          </div>
          <div>
            <ShieldCheck size={17} aria-hidden="true" />
            <span>
              <strong>{t("desktop.telemetryErrors")}</strong>
              <small>{t("desktop.telemetryPrivacyHint")}</small>
            </span>
          </div>
        </div>

        <footer className="getting-started-actions">
          {desktopRuntime ? (
            <Button onClick={onCreateConnection}>
              <Plus size={15} aria-hidden="true" /> {t("desktop.newConnection")}
            </Button>
          ) : null}
          <Button variant="ghost" onClick={onClose}>
            {t("desktop.close")}
          </Button>
        </footer>
      </Panel>
    </div>
  );
});
