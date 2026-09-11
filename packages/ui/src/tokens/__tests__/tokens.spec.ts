import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { buildThemeCss } from "../css";
import { semantic, EColorScheme, type SemanticTheme } from "../semantic";

describe("semantic tokens", () => {
  test("dark theme covers every light token", () => {
    const lightKeys = Object.keys(semantic[EColorScheme.Light]);
    const darkKeys = Object.keys(semantic[EColorScheme.Dark]);
    expect(darkKeys.sort()).toEqual(lightKeys.sort());
  });

  test("no token value is empty", () => {
    for (const scheme of Object.values(EColorScheme)) {
      const theme: SemanticTheme = semantic[scheme];
      for (const [name, value] of Object.entries(theme)) {
        expect(value, `${scheme}.${name}`).toBeTruthy();
      }
    }
  });
});

describe("theme.css", () => {
  test("checked-in stylesheet matches the current tokens", () => {
    const onDisk = readFileSync(
      `${import.meta.dir}/../../styles/theme.css`,
      "utf8",
    );
    expect(onDisk).toBe(buildThemeCss());
  });

  test("exposes every semantic token as a Tailwind color", () => {
    const css = buildThemeCss();
    for (const name of Object.keys(semantic[EColorScheme.Light])) {
      const kebab = name.replace(/[A-Z]/g, (l) => `-${l.toLowerCase()}`);
      expect(css).toContain(`--color-${kebab}: var(--${kebab});`);
    }
  });
});
