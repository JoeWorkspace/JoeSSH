import { memo } from "react";
import { SUPPORTED_LOCALES, getLocaleMeta, type AtlasLocale, type Translator } from "@atlasterm/i18n";

type LanguageChoice = AtlasLocale | "auto";

export const LanguagePicker = memo(function LanguagePicker({
  currentLocale,
  languageChoice,
  onLanguageChoiceChange,
  t,
}: {
  currentLocale: AtlasLocale;
  languageChoice: LanguageChoice;
  onLanguageChoiceChange: (choice: LanguageChoice) => void;
  t: Translator;
}) {
  const activeLocale = getLocaleMeta(currentLocale);

  return (
    <label className="language-picker">
      <span>{t("language.selectorLabel")}</span>
      <select value={languageChoice} onChange={(event) => onLanguageChoiceChange(event.currentTarget.value as LanguageChoice)}>
        <option value="auto">{t("language.autoRegion")}</option>
        {SUPPORTED_LOCALES.map((supportedLocale) => (
          <option key={supportedLocale.code} value={supportedLocale.code}>
            {supportedLocale.nativeName}
          </option>
        ))}
      </select>
      <small>
        {t("language.autoRegion")} / {activeLocale.englishName}
      </small>
    </label>
  );
});
