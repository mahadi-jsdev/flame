import { describe, expect, it } from "vitest";
import { isImagePath, lspLanguageIdForPath } from "./codeLang";

describe("isImagePath", () => {
  it("recognizes common raster extensions case-insensitively", () => {
    expect(isImagePath("logo.png")).toBe(true);
    expect(isImagePath("photo.JPG")).toBe(true);
    expect(isImagePath("photo.jpeg")).toBe(true);
    expect(isImagePath("banner.webp")).toBe(true);
    expect(isImagePath("anim.gif")).toBe(true);
    expect(isImagePath("scan.bmp")).toBe(true);
    expect(isImagePath("favicon.ico")).toBe(true);
  });

  it("does not treat .svg as an image preview (it's editable text)", () => {
    expect(isImagePath("icon.svg")).toBe(false);
  });

  it("returns false for non-image extensions", () => {
    expect(isImagePath("README.md")).toBe(false);
    expect(isImagePath("noextension")).toBe(false);
  });
});

describe("lspLanguageIdForPath", () => {
  it("maps .ts to typescript", () => {
    expect(lspLanguageIdForPath("src/a.ts")).toBe("typescript");
  });

  it("maps .tsx to typescriptreact", () => {
    expect(lspLanguageIdForPath("src/App.tsx")).toBe("typescriptreact");
  });

  it("maps .js, .mjs, and .cjs to javascript", () => {
    expect(lspLanguageIdForPath("a.js")).toBe("javascript");
    expect(lspLanguageIdForPath("a.mjs")).toBe("javascript");
    expect(lspLanguageIdForPath("a.cjs")).toBe("javascript");
  });

  it("maps .jsx to javascriptreact", () => {
    expect(lspLanguageIdForPath("App.jsx")).toBe("javascriptreact");
  });

  it("returns null for non-JS/TS extensions", () => {
    expect(lspLanguageIdForPath("README.md")).toBeNull();
    expect(lspLanguageIdForPath("styles.css")).toBeNull();
    expect(lspLanguageIdForPath("noextension")).toBeNull();
  });
});
