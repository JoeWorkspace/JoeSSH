import { describe, expect, it } from "vitest";
import type { Translator } from "@atlasterm/i18n";
import { builtinGroupNames, desktopGroupLabel, desktopGroupLabelKey } from "./desktopGroups";

describe("desktop group labels", () => {
  it("maps built-in groups to translation keys", () => {
    expect(builtinGroupNames).toEqual(["Production", "Staging", "CI runners", "Data"]);
    expect(desktopGroupLabelKey("Production")).toBe("desktop.groupProduction");
    expect(desktopGroupLabelKey("Staging")).toBe("desktop.groupStaging");
    expect(desktopGroupLabelKey("CI runners")).toBe("desktop.groupCI");
    expect(desktopGroupLabelKey("Data")).toBe("desktop.groupData");
  });

  it("keeps custom group labels verbatim", () => {
    let translateCalls = 0;
    const t: Translator = (key) => {
      translateCalls += 1;
      return key;
    };

    expect(desktopGroupLabel("My Group", t)).toBe("My Group");
    expect(translateCalls).toBe(0);
  });

  it("localizes built-in labels through the translator", () => {
    const t = ((key) => `localized:${key}`) as Translator;

    expect(desktopGroupLabel("Production", t)).toBe("localized:desktop.groupProduction");
  });
});
