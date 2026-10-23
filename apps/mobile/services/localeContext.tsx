import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { createTranslator, loadLocale, type Translator } from "@atlasterm/i18n";

import { applyWebDocumentLanguage } from "@/services/documentLanguage";
import {
  getStoredMobileLocaleMode,
  persistMobileLocaleMode,
  resolveMobileLocale,
  type LocaleMode,
  type MobileLocaleState,
} from "@/services/locale";

type MobileLocaleContextValue = {
  localeMode: LocaleMode;
  localeState: MobileLocaleState;
  setLocaleMode: (mode: LocaleMode) => void;
  t: Translator;
};

const MobileLocaleContext = createContext<MobileLocaleContextValue | undefined>(
  undefined,
);

export function MobileLocaleProvider({ children }: PropsWithChildren) {
  const [localeMode, setLocaleModeState] = useState<LocaleMode>("auto");
  const localeState = useMemo(
    () => resolveMobileLocale(localeMode),
    [localeMode],
  );
  const [t, setT] = useState<Translator>(() =>
    createTranslator(localeState.locale),
  );

  useEffect(() => {
    let cancelled = false;
    getStoredMobileLocaleMode().then((storedMode) => {
      if (!cancelled) {
        setLocaleModeState(storedMode);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadLocale(localeState.locale).then((translator) => {
      if (!cancelled) {
        setT(() => translator);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [localeState.locale]);

  useEffect(
    () => applyWebDocumentLanguage(localeState.locale),
    [localeState.locale],
  );

  const setLocaleMode = useCallback((mode: LocaleMode) => {
    setLocaleModeState(mode);
    void persistMobileLocaleMode(mode);
  }, []);

  const value = useMemo(
    () => ({ localeMode, localeState, setLocaleMode, t }),
    [localeMode, localeState, setLocaleMode, t],
  );

  return (
    <MobileLocaleContext.Provider value={value}>
      {children}
    </MobileLocaleContext.Provider>
  );
}

export function useMobileLocale() {
  const context = useContext(MobileLocaleContext);

  if (!context) {
    throw new Error(
      "useMobileLocale must be used within a MobileLocaleProvider.",
    );
  }

  return context;
}
