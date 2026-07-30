import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

describe("mobile production module resolution", () => {
  it("never aliases native runtime packages to test doubles", () => {
    const tsconfig = JSON.parse(
      readFileSync(
        resolve(dirname(fileURLToPath(import.meta.url)), "../tsconfig.json"),
        "utf8",
      ),
    ) as {
      compilerOptions?: {
        paths?: Record<string, string[]>;
      };
    };
    const paths = tsconfig.compilerOptions?.paths ?? {};

    expect(paths["react-native"]).toBeUndefined();
    expect(paths["react-native-safe-area-context"]).toBeUndefined();
  });

  it("uses the cross-platform box-shadow API without deprecated shadow props", () => {
    const testDirectory = dirname(fileURLToPath(import.meta.url));
    const appSource = ["../app/index.tsx", "../app/_layout.tsx"]
      .map((path) => readFileSync(resolve(testDirectory, path), "utf8"))
      .join("\n");

    expect(appSource).not.toMatch(
      /\bshadow(?:Color|Offset|Opacity|Radius)\s*:/,
    );
    expect(appSource).toContain("boxShadow:");
  });
});
