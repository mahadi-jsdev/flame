import { describe, expect, it } from "vitest";
import {
  buildTree,
  projectName,
  quotedShell,
  statusColor,
  statusLabel,
} from "./gitUtils";

const e = (status: string, path: string, original_path?: string) => ({
  status,
  path,
  original_path: original_path ?? null,
});

describe("projectName", () => {
  it("returns last path segment", () => {
    expect(projectName("/home/u/projects/foo")).toBe("foo");
  });
  it("handles trailing slash", () => {
    expect(projectName("/home/u/foo/")).toBe("foo");
  });
  it("handles windows paths", () => {
    expect(projectName("C:\\Users\\u\\proj")).toBe("proj");
  });
  it("handles bare name", () => {
    expect(projectName("repo")).toBe("repo");
  });
  it("root path falls back to input", () => {
    expect(projectName("/")).toBe("/");
  });
  it("empty falls back to input", () => {
    expect(projectName("")).toBe("");
  });
});

describe("statusColor", () => {
  it.each([
    ["??", "slate"],
    ["!!", "slate"],
    ["A ", "emerald"],
    [" A", "emerald"],
    ["D ", "rose"],
    [" D", "rose"],
    ["M ", "amber"],
    [" M", "amber"],
    ["MM", "amber"],
    ["R ", "cyan"],
    ["C ", "violet"],
    ["UU", "slate"],
    ["", "slate"],
  ])("%s -> %s", (status, color) => {
    expect(statusColor(status)).toContain(color);
  });
});

describe("statusLabel", () => {
  it.each([
    ["??", "untracked"],
    ["!!", "ignored"],
    ["R ", "renamed"],
    ["R1", "renamed"],
    ["C ", "copied"],
    [" M", "modified"],
    ["M ", "staged"],
    [" A", "added"],
    ["A ", "staged add"],
    [" D", "deleted"],
    ["D ", "staged del"],
    ["MM", "staged + modified"],
    ["AM", "added + modified"],
    ["RM", "renamed + modified"],
    ["CM", "copied + modified"],
  ])("%s -> %s", (status, label) => {
    expect(statusLabel(status)).toBe(label);
  });

  it("unknown status shows trimmed raw value", () => {
    expect(statusLabel(" T")).toBe("T");
  });

  it("blank status shows unchanged", () => {
    expect(statusLabel("  ")).toBe("unchanged");
  });
});

describe("quotedShell", () => {
  it("wraps in single quotes", () => {
    expect(quotedShell("abc")).toBe("'abc'");
  });
  it("passes spaces through safely", () => {
    expect(quotedShell("/a b/c")).toBe("'/a b/c'");
  });
  it("escapes embedded single quotes", () => {
    expect(quotedShell("it's")).toBe("'it'\\''s'");
  });
  it("escapes multiple quotes", () => {
    expect(quotedShell("a'b'c")).toBe("'a'\\''b'\\''c'");
  });
  it("empty string", () => {
    expect(quotedShell("")).toBe("''");
  });
});

describe("buildTree", () => {
  it("empty entries -> empty root", () => {
    const t = buildTree([]);
    expect(t.dirs).toEqual([]);
    expect(t.files).toEqual([]);
  });

  it("top-level files land on root", () => {
    const t = buildTree([e(" M", "a.ts"), e(" M", "b.ts")]);
    expect(t.dirs).toEqual([]);
    expect(t.files.map((f) => f.name)).toEqual(["a.ts", "b.ts"]);
  });

  it("nested paths become directories", () => {
    const t = buildTree([e(" M", "src/lib/x.ts")]);
    expect(t.dirs[0].name).toBe("src/lib");
    expect(t.dirs[0].files[0].name).toBe("x.ts");
    expect(t.dirs[0].path).toBe("src/lib");
  });

  it("sibling files share the directory", () => {
    const t = buildTree([e(" M", "src/a.ts"), e(" M", "src/b.ts")]);
    expect(t.dirs).toHaveLength(1);
    expect(t.dirs[0].files).toHaveLength(2);
  });

  it("dirs and files sort alphabetically, dirs grouped first by caller", () => {
    const t = buildTree([
      e(" M", "z.ts"),
      e(" M", "a.ts"),
      e(" M", "zed/x.ts"),
      e(" M", "abc/y.ts"),
    ]);
    expect(t.files.map((f) => f.name)).toEqual(["a.ts", "z.ts"]);
    expect(t.dirs.map((d) => d.name)).toEqual(["abc", "zed"]);
  });

  it("compresses single-child directory chains", () => {
    const t = buildTree([e(" M", "a/b/c/d.ts")]);
    expect(t.dirs).toHaveLength(1);
    expect(t.dirs[0].name).toBe("a/b/c");
    expect(t.dirs[0].files[0].name).toBe("d.ts");
  });

  it("does not compress when a dir has files AND subdirs", () => {
    const t = buildTree([e(" M", "a/file.ts"), e(" M", "a/b/x.ts")]);
    expect(t.dirs[0].name).toBe("a");
    expect(t.dirs[0].files[0].name).toBe("file.ts");
    expect(t.dirs[0].dirs[0].name).toBe("b");
  });

  it("does not compress when a dir has two subdirs", () => {
    const t = buildTree([e(" M", "a/x/f1.ts"), e(" M", "a/y/f2.ts")]);
    expect(t.dirs[0].name).toBe("a");
    expect(t.dirs[0].dirs.map((d) => d.name)).toEqual(["x", "y"]);
  });

  it("preserves entry objects incl. rename original_path", () => {
    const t = buildTree([e("R ", "new/name.ts", "old/name.ts")]);
    expect(t.dirs[0].name).toBe("new");
    expect(t.dirs[0].files[0].entry.original_path).toBe("old/name.ts");
  });

  it("deep mixed tree builds correctly", () => {
    const t = buildTree([
      e(" M", "src/components/ProjectPanel.tsx"),
      e(" M", "src/components/Sidebar.tsx"),
      e("??", "src/lib/util.ts"),
      e("A ", "README.md"),
    ]);
    expect(t.files[0].name).toBe("README.md");
    const src = t.dirs.find((d) => d.name.startsWith("src"))!;
    expect(src).toBeDefined();
  });
});
