import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { buildThemeCss } from "../css";
import { semantic, EColorScheme, type SemanticTheme } from "../semantic";

function toKebab(name: string): string {
  return name.replace(/[A-Z]/g, (l) => `-${l.toLowerCase()}`);
}

describe("semantic tokens", () => {
  test("both themes define exactly the same keys", () => {
    const darkKeys = Object.keys(semantic[EColorScheme.Dark]);
    const lightKeys = Object.keys(semantic[EColorScheme.Light]);
    expect(lightKeys.sort()).toEqual(darkKeys.sort());
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

  test("is dark-first: :root holds the dark theme, light is opt-in", () => {
    const css = buildThemeCss();
    expect(css).toContain(
      `:root {\n  --background: ${semantic[EColorScheme.Dark].background};`,
    );
    expect(css).toContain(
      `[data-theme="day"], [data-theme="light"], .light {\n  --background: ${semantic[EColorScheme.Light].background};`,
    );
  });

  test("routes every semantic token to its Tailwind namespace", () => {
    const css = buildThemeCss();
    for (const name of Object.keys(semantic[EColorScheme.Dark])) {
      const kebab = toKebab(name);
      if (kebab.startsWith("shadow-") || kebab.startsWith("glow-")) {
        expect(css).toContain(
          `--shadow-${kebab.replace(/^shadow-/, "")}: var(--${kebab});`,
        );
      } else {
        expect(css).toContain(`--color-${kebab}: var(--${kebab});`);
      }
    }
  });

  test("exposes the primitive ramps as Tailwind colors", () => {
    const css = buildThemeCss();
    for (const ramp of [
      "warm",
      "clay",
      "blue",
      "steel",
      "red",
      "amber",
      "green",
      "violet",
    ]) {
      expect(css).toContain(`--color-${ramp}-`);
    }
  });

  test("the spacing base makes numeric utilities match the 2px scale", () => {
    expect(buildThemeCss()).toContain("--spacing: 2px;");
  });
});
