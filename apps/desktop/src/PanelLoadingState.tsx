import { LoaderCircle } from "lucide-react";
import type { Translator } from "@atlasterm/i18n";

type PanelLoadingStateProps = {
  t: Translator;
};

export function PanelLoadingState({ t }: PanelLoadingStateProps) {
  return (
    <div className="panel-loading" aria-busy="true" role="status">
      <span className="panel-loading-icon">
        <LoaderCircle size={18} aria-hidden="true" />
      </span>
      <span className="panel-loading-copy">
        <strong>{t("desktop.panelLoading")}</strong>
        <small>{t("desktop.panelLoadingHint")}</small>
      </span>
      <span className="panel-loading-skeleton" aria-hidden="true">
        <span className="skeleton skeleton--text" />
        <span className="skeleton skeleton--text-sm" />
      </span>
    </div>
  );
}
