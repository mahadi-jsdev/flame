import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export type PtyDataPayload = { id: string; chunk_b64: string };
export type PtyExitPayload = { id: string; exit_code: number | null };

export function spawnPty(shell?: string, rows = 24, cols = 80) {
  return invoke<string>("spawn_pty", { shell, rows, cols });
}

export function writePty(id: string, data: string) {
  return invoke<void>("write_pty", { id, data });
}

export function resizePty(id: string, rows: number, cols: number) {
  return invoke<void>("resize_pty", { id, rows, cols });
}

export function killPty(id: string) {
  return invoke<void>("kill_pty", { id });
}

export function onPtyData(cb: (payload: PtyDataPayload) => void) {
  return listen<PtyDataPayload>("pty-data", (e) => cb(e.payload));
}

export function onPtyExit(cb: (payload: PtyExitPayload) => void) {
  return listen<PtyExitPayload>("pty-exit", (e) => cb(e.payload));
}
