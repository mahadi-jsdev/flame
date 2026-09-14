import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TitleBar } from "./TitleBar";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  vi.doUnmock("@tauri-apps/api/window");
});

describe("TitleBar", () => {
  it("renders the brand and all three window controls", () => {
    render(<TitleBar />);
    expect(screen.getByText("Flame")).toBeInTheDocument();
    expect(screen.getByTitle("Minimize")).toBeInTheDocument();
    expect(screen.getByTitle("Maximize")).toBeInTheDocument();
    expect(screen.getByTitle("Close window")).toBeInTheDocument();
  });

  it("clicking the window controls outside Tauri is a safe no-op", async () => {
    render(<TitleBar />);
    expect(() => {
      fireEvent.click(screen.getByTitle("Minimize"));
      fireEvent.click(screen.getByTitle("Maximize"));
      fireEvent.click(screen.getByTitle("Close window"));
    }).not.toThrow();
    // still just idle, unmaximized — nothing crashed or changed state
    expect(await screen.findByTitle("Maximize")).toBeInTheDocument();
  });

  it("shows a restore icon and title once the window reports itself maximized", async () => {
    vi.stubGlobal("__TAURI_INTERNALS__", {});
    vi.doMock("@tauri-apps/api/window", () => ({
      getCurrentWindow: () => ({
        isMaximized: async () => true,
        onResized: async () => () => {},
      }),
    }));
    const { TitleBar: MockedTitleBar } = await import("./TitleBar");
    render(<MockedTitleBar />);
    await waitFor(() => expect(screen.getByTitle("Restore")).toBeInTheDocument());
    expect(screen.queryByTitle("Maximize")).not.toBeInTheDocument();
  });
});
