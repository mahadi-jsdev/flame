import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SettingsDialog } from "./SettingsDialog";
import {
  defaultSettings,
  useWorkspaceStore,
} from "../store/workspaceStore";

const mocks = vi.hoisted(() => ({
  hasApiKey: vi.fn(async () => false),
  saveApiKey: vi.fn(async () => {}),
  deleteApiKey: vi.fn(async () => {}),
}));

vi.mock("../lib/tauri", () => ({
  hasApiKey: mocks.hasApiKey,
  saveApiKey: mocks.saveApiKey,
  deleteApiKey: mocks.deleteApiKey,
}));

const store = () => useWorkspaceStore.getState();

beforeEach(() => {
  localStorage.clear();
  useWorkspaceStore.setState({ settings: defaultSettings });
  vi.clearAllMocks();
  mocks.hasApiKey.mockResolvedValue(false);
});

describe("SettingsDialog", () => {
  it("renders all setting rows", () => {
    render(<SettingsDialog onClose={() => {}} />);
    for (const label of [
      "Font size",
      "Cursor style",
      "Cursor blink",
      "Scrollback",
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("font size slider updates store", () => {
    render(<SettingsDialog onClose={() => {}} />);
    fireEvent.change(screen.getByRole("slider"), { target: { value: "17" } });
    expect(store().settings.fontSize).toBe(17);
  });

  it("cursor style segmented updates store", () => {
    render(<SettingsDialog onClose={() => {}} />);
    fireEvent.click(screen.getByText("Block"));
    expect(store().settings.cursorStyle).toBe("block");
  });

  it("cursor blink toggle flips store", () => {
    render(<SettingsDialog onClose={() => {}} />);
    fireEvent.click(screen.getByTitle("Toggle cursor blink"));
    expect(store().settings.cursorBlink).toBe(false);
  });

  it("scrollback segmented updates store", () => {
    render(<SettingsDialog onClose={() => {}} />);
    fireEvent.click(screen.getByText("50k"));
    expect(store().settings.scrollback).toBe(50000);
  });

  it("Escape closes", () => {
    const onClose = vi.fn();
    render(<SettingsDialog onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("backdrop click closes", () => {
    const onClose = vi.fn();
    const { container } = render(<SettingsDialog onClose={onClose} />);
    fireEvent.click(container.firstChild as Element);
    expect(onClose).toHaveBeenCalled();
  });

  it("clicking inside the card does not close", () => {
    const onClose = vi.fn();
    render(<SettingsDialog onClose={onClose} />);
    fireEvent.click(screen.getByText("Font size"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("X button closes", () => {
    const onClose = vi.fn();
    render(<SettingsDialog onClose={onClose} />);
    fireEvent.click(screen.getByTitle("Close"));
    expect(onClose).toHaveBeenCalled();
  });

  it("restore session toggle flips store", () => {
    render(<SettingsDialog onClose={() => {}} />);
    fireEvent.click(screen.getByTitle("Toggle session restore"));
    expect(store().settings.restoreSession).toBe(false);
  });

  it("theme segmented updates store", () => {
    render(<SettingsDialog onClose={() => {}} />);
    fireEvent.click(screen.getByText("Midnight"));
    expect(store().settings.theme).toBe("midnight");
  });

  it("shows a save form when no key is configured, and saves it", async () => {
    render(<SettingsDialog onClose={() => {}} />);
    const input = await screen.findByPlaceholderText("sk-...");
    fireEvent.change(input, { target: { value: "sk-test" } });
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(mocks.saveApiKey).toHaveBeenCalledWith("sk-test"));
    expect(await screen.findByText("Configured")).toBeInTheDocument();
  });

  it("shows Configured and allows removing an existing key", async () => {
    mocks.hasApiKey.mockResolvedValue(true);
    render(<SettingsDialog onClose={() => {}} />);
    expect(await screen.findByText("Configured")).toBeInTheDocument();
    fireEvent.click(screen.getByTitle("Remove key from keychain"));
    await waitFor(() => expect(mocks.deleteApiKey).toHaveBeenCalled());
    expect(await screen.findByPlaceholderText("sk-...")).toBeInTheDocument();
  });
});
