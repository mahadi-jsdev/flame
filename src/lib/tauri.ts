import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export type PtyDataPayload = { id: string; chunk_b64: string };
export type PtyExitPayload = { id: string; exit_code: number | null };
export type PtySpawnResult = { id: string; shell: string };

export type GitStatusEntry = {
  status: string;
  path: string;
  original_path: string | null;
};

export function gitStatus(path: string) {
  return invoke<GitStatusEntry[]>("git_status_cmd", { path });
}

export function gitBranch(path: string) {
  return invoke<string | null>("git_branch_cmd", { path });
}

export function gitBranches(path: string) {
  return invoke<string[]>("git_branches_cmd", { path });
}

export function gitCheckout(path: string, branch: string) {
  return invoke<void>("git_checkout_cmd", { path, branch });
}

export function gitRoot(path: string) {
  return invoke<string>("git_root_cmd", { path });
}

export function gitAutoCommit(path: string, apiKey: string, model?: string) {
  return invoke<string>("git_auto_commit_cmd", { path, apiKey, model });
}

export function spawnPty(shell?: string, rows = 24, cols = 80, cwd?: string) {
  return invoke<PtySpawnResult>("spawn_pty", { shell, rows, cols, cwd });
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
