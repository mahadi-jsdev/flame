import { describe, expect, it } from "vitest";
import { applyUiTheme, DEFAULT_THEME, resolveTheme, THEMES } from "./themes";

describe("resolveTheme", () => {
  it("returns the terminal palette for a known theme", () => {
    expect(resolveTheme("forest").background).toBe(THEMES.forest.theme.background);
  });

  it("falls back to the default theme for an unknown name", () => {
    expect(resolveTheme("nope")).toEqual(THEMES[DEFAULT_THEME].theme);
  });
});

describe("applyUiTheme", () => {
  it("sets the accent CSS variables to the theme's UI colors", () => {
    applyUiTheme("sunset");
    const style = document.documentElement.style;
    expect(style.getPropertyValue("--ui-accent")).toBe(THEMES.sunset.ui.accent);
    expect(style.getPropertyValue("--ui-accent-2")).toBe(THEMES.sunset.ui.accent2);
  });

  it("falls back to the default theme's colors for an unknown name", () => {
    applyUiTheme("does-not-exist");
    const style = document.documentElement.style;
    expect(style.getPropertyValue("--ui-accent")).toBe(THEMES[DEFAULT_THEME].ui.accent);
  });
});
