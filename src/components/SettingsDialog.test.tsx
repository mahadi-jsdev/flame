import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { SettingsDialog } from "./SettingsDialog";
import {
  defaultSettings,
  useWorkspaceStore,
} from "../store/workspaceStore";

const store = () => useWorkspaceStore.getState();

beforeEach(() => {
  localStorage.clear();
  useWorkspaceStore.setState({ settings: defaultSettings });
});

describe("SettingsDialog", () => {
  it("renders all setting rows", () => {
    render(<SettingsDialog onClose={() => {}} />);
    for (const label of [
      "Font size",
      "Cursor style",
      "Cursor blink",
      "Scrollback",
      "Diff viewer",
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

  it("diff viewer segmented updates store", () => {
    render(<SettingsDialog onClose={() => {}} />);
    fireEvent.click(screen.getByText("Delta"));
    expect(store().settings.diffViewer).toBe("delta");
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
});
