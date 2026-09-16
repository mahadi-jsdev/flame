import { describe, expect, it } from "vitest";
import { lspLanguageIdForPath } from "./codeLang";

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
