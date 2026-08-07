import { memo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  HardDrive,
  Info,
  ListChecks,
  Network,
  Plus,
  Plug,
  ShieldCheck,
  SkipForward,
  TerminalSquare,
  X,
} from "lucide-react";
import { Badge, Button, IconButton, Panel } from "@atlasterm/ui";
import type { Translator } from "@atlasterm/i18n";
import { useFocusTrap } from "./useFocusTrap";
import type { GettingStartedStep } from "./persistence";

const STEP_COUNT = 3;

export const GettingStartedOverlay = memo(function GettingStartedOverlay({
  desktopRuntime,
  initialStep = 0,
  onClose,
  onComplete,
  onCreateConnection,
  onOpenConnect,
  onOpenForwarding,
  onOpenSftp,
  onOpenTerminal,
  onSkip,
  onStepChange,
  showCompanionProductSurfaces = true,
  t,
}: {
  desktopRuntime: boolean;
  initialStep?: GettingStartedStep;
  onClose: () => void;
  onComplete?: () => void;
  onCreateConnection: () => void;
  onOpenConnect?: () => void;
  onOpenForwarding?: () => void;
  onOpenSftp?: () => void;
  onOpenTerminal?: () => void;
  onSkip?: () => void;
  onStepChange?: (step: GettingStartedStep) => void;
  showCompanionProductSurfaces?: boolean;
  t: Translator;
}) {
  const focusTrapRef = useFocusTrap<HTMLDivElement>(true);
  const [step, setStep] = useState<GettingStartedStep>(initialStep);
  const stepTitles = [
    t("desktop.gettingStartedStepCreate"),
    t("desktop.gettingStartedStepSecure"),
    t("desktop.gettingStartedStepUse"),
  ] as const;
  const stepDetails = [
    t("desktop.gettingStartedStepCreateDetail"),
    t("desktop.gettingStartedStepSecureDetail"),
    t("desktop.gettingStartedStepUseDetail"),
  ] as const;
  const stepIcons: Record<GettingStartedStep, typeof Plus> = {
    0: Plus,
    1: ShieldCheck,
    2: TerminalSquare,
  };
  const StepIcon = stepIcons[step];

  function changeStep(nextStep: GettingStartedStep) {
    setStep(nextStep);
    onStepChange?.(nextStep);
  }

  function handleClose() {
    onClose();
  }

  return (
    <div
      className="palette-scrim getting-started-scrim"
      onClick={handleClose}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          handleClose();
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
            <ListChecks size={20} aria-hidden="true" />
          </span>
          <div>
            <Badge>JoeSSH</Badge>
            <h2>{t("desktop.gettingStarted")}</h2>
          </div>
          <IconButton label={t("desktop.close")} onClick={handleClose}>
            <X size={16} />
          </IconButton>
        </header>

        {showCompanionProductSurfaces ? (
          <p className="getting-started-companion-note">
            {t("desktop.surfaceGuide")}
          </p>
        ) : null}

        <nav
          aria-label={t("desktop.gettingStarted")}
          className="getting-started-stepper"
        >
          <ol>
            {stepTitles.map((title, index) => (
              <li key={title}>
                <button
                  aria-current={index === step ? "step" : undefined}
                  className={index === step ? "is-active" : undefined}
                  onClick={() => changeStep(index as GettingStartedStep)}
                  type="button"
                >
                  <span className="getting-started-step-number">
                    {index + 1}
                  </span>
                  <span>{title}</span>
                </button>
              </li>
            ))}
          </ol>
        </nav>

        <section className="getting-started-step-content" aria-live="polite">
          <div className="getting-started-step-heading">
            <StepIcon size={20} aria-hidden="true" />
            <div>
              <span className="getting-started-step-count">
                {t("desktop.gettingStartedStepCount", {
                  current: step + 1,
                  total: STEP_COUNT,
                })}
              </span>
              <h3>{stepTitles[step]}</h3>
            </div>
          </div>
          <p>{stepDetails[step]}</p>

          {step === 0 ? (
            <div className="getting-started-step-actions">
              <div className="getting-started-step-note">
                <Info size={16} aria-hidden="true" />
                <span>{t("desktop.gettingStartedSampleData")}</span>
              </div>
              {desktopRuntime ? (
                <Button onClick={onCreateConnection}>
                  <Plus size={15} aria-hidden="true" />
                  {t("desktop.newConnection")}
                </Button>
              ) : null}
            </div>
          ) : null}

          {step === 1 ? (
            <div className="getting-started-step-actions">
              <div className="getting-started-step-note">
                <ShieldCheck size={16} aria-hidden="true" />
                <span>{t("desktop.gettingStartedSecurityNote")}</span>
              </div>
              {desktopRuntime && onOpenConnect ? (
                <Button onClick={onOpenConnect}>
                  <Plug size={15} aria-hidden="true" />
                  {t("desktop.gettingStartedOpenConnect")}
                </Button>
              ) : null}
            </div>
          ) : null}

          {step === 2 ? (
            <div className="getting-started-step-actions getting-started-step-actions--multi">
              {onOpenTerminal ? (
                <Button variant="ghost" onClick={onOpenTerminal}>
                  <TerminalSquare size={15} aria-hidden="true" />
                  {t("desktop.gettingStartedOpenTerminal")}
                </Button>
              ) : null}
              {onOpenSftp ? (
                <Button variant="ghost" onClick={onOpenSftp}>
                  <HardDrive size={15} aria-hidden="true" />
                  {t("desktop.gettingStartedOpenSftp")}
                </Button>
              ) : null}
              {onOpenForwarding ? (
                <Button variant="ghost" onClick={onOpenForwarding}>
                  <Network size={15} aria-hidden="true" />
                  {t("desktop.gettingStartedOpenForwarding")}
                </Button>
              ) : null}
            </div>
          ) : null}
        </section>

        <footer className="getting-started-actions">
          <Button
            className="getting-started-nav-button"
            disabled={step === 0}
            variant="ghost"
            onClick={() => changeStep((step - 1) as GettingStartedStep)}
          >
            <ArrowLeft
              className="getting-started-nav-icon"
              size={15}
              aria-hidden="true"
            />
            {t("desktop.gettingStartedPrevious")}
          </Button>
          <span className="getting-started-actions-main">
            <Button variant="ghost" onClick={onSkip ?? handleClose}>
              <SkipForward size={15} aria-hidden="true" />
              {t("desktop.gettingStartedSkip")}
            </Button>
            <Button variant="ghost" onClick={handleClose}>
              {t("desktop.close")}
            </Button>
            {step < STEP_COUNT - 1 ? (
              <Button
                className="getting-started-nav-button"
                onClick={() => changeStep((step + 1) as GettingStartedStep)}
              >
                {t("desktop.gettingStartedNext")}
                <ArrowRight
                  className="getting-started-nav-icon"
                  size={15}
                  aria-hidden="true"
                />
              </Button>
            ) : (
              <Button onClick={onComplete ?? handleClose}>
                <Check size={15} aria-hidden="true" />
                {t("desktop.gettingStartedComplete")}
              </Button>
            )}
          </span>
        </footer>
      </Panel>
    </div>
  );
});
