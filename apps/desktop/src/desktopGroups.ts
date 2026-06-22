import type { TranslationKey, Translator } from "@atlasterm/i18n";

export const builtinGroupNames = ["Production", "Staging", "CI runners", "Data"] as const;

export type BuiltinGroupName = (typeof builtinGroupNames)[number];

const builtinGroupLabelKeys = {
  Production: "desktop.groupProduction",
  Staging: "desktop.groupStaging",
  "CI runners": "desktop.groupCI",
  Data: "desktop.groupData",
} satisfies Record<BuiltinGroupName, TranslationKey>;

export function desktopGroupLabel(groupName: string, t: Translator): string {
  const labelKey = desktopGroupLabelKey(groupName);
  return labelKey ? t(labelKey) : groupName;
}

export function desktopGroupLabelKey(groupName: string): TranslationKey | undefined {
  return builtinGroupLabelKeys[groupName as BuiltinGroupName];
}
