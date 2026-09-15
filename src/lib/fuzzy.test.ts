import { describe, expect, it } from "vitest";
import { fuzzyScore } from "./fuzzy";

describe("fuzzyScore", () => {
  it("matches a subsequence out of order in the string but in query order", () => {
    expect(fuzzyScore("gpt", "src/components/GitPanel.tsx")).not.toBeNull();
  });

  it("returns null when a query character is missing", () => {
    expect(fuzzyScore("xyz", "GitPanel.tsx")).toBeNull();
  });

  it("returns null when query characters are out of order", () => {
    expect(fuzzyScore("tsxgit", "GitPanel.tsx")).toBeNull();
  });

  it("empty query matches everything with score 0", () => {
    expect(fuzzyScore("", "anything.ts")).toBe(0);
  });

  it("is case-insensitive", () => {
    expect(fuzzyScore("GITPANEL", "src/components/gitpanel.tsx")).not.toBeNull();
  });

  it("ranks a basename-prefix match above a mid-string match", () => {
    const prefix = fuzzyScore("git", "GitPanel.tsx");
    const midString = fuzzyScore("git", "src/legit/x.tsx");
    expect(prefix).not.toBeNull();
    expect(midString).not.toBeNull();
    expect(prefix!).toBeGreaterThan(midString!);
  });

  it("ranks consecutive-character matches above scattered ones", () => {
    const consecutive = fuzzyScore("gitpanel", "GitPanel.tsx");
    const scattered = fuzzyScore("gitpanel", "Gizt_izp_azn_ezl.tsx");
    expect(consecutive).not.toBeNull();
    expect(scattered).not.toBeNull();
    expect(consecutive!).toBeGreaterThan(scattered!);
  });

  it("ranks a shorter path above a longer one for an otherwise equal match", () => {
    const short = fuzzyScore("app", "app.ts");
    const long = fuzzyScore("app", "app.extra.padding.ts");
    expect(short).not.toBeNull();
    expect(long).not.toBeNull();
    expect(short!).toBeGreaterThan(long!);
  });

  it("matches every character of the target when query equals target", () => {
    expect(fuzzyScore("index.ts", "index.ts")).not.toBeNull();
  });
});
