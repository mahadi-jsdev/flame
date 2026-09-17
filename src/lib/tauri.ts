import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export type PtyDataPayload = { id: string; chunk_b64: string };
export type PtyExitPayload = { id: string; exit_code: number | null };
export type PtySpawnResult = { id: string; shell: string };

export interface LspMessagePayload {
  root: string;
  message: string;
}

export interface LspExitPayload {
  root: string;
}

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

export function gitAutoCommit(path: string, model?: string) {
  return invoke<string>("git_auto_commit_cmd", { path, model });
}

export function gitDiffFile(path: string, file: string) {
  return invoke<string>("git_diff_file_cmd", { path, file });
}

export function readTextFile(path: string) {
  return invoke<string>("read_text_file_cmd", { path });
}

export function writeTextFile(path: string, content: string) {
  return invoke<void>("write_text_file_cmd", { path, content });
}

/** Resolves to a ready-to-use `data:image/...;base64,...` URL. */
export function readImageFile(path: string) {
  return invoke<string>("read_image_file_cmd", { path });
}

export function listProjectFiles(path: string) {
  return invoke<string[]>("list_project_files_cmd", { path });
}

export function hasApiKey() {
  return invoke<boolean>("has_api_key_cmd");
}

export function saveApiKey(key: string) {
  return invoke<void>("save_api_key_cmd", { key });
}

export function deleteApiKey() {
  return invoke<void>("delete_api_key_cmd");
}

export async function pickDirectory(): Promise<string | null> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const path = await open({ directory: true });
  return typeof path === "string" ? path : null;
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

export function lspSpawn(root: string) {
  return invoke<void>("lsp_spawn", { root });
}

export function lspSend(root: string, message: string) {
  return invoke<void>("lsp_send", { root, message });
}

export function lspKill(root: string) {
  return invoke<void>("lsp_kill", { root });
}

export function onLspMessage(cb: (payload: LspMessagePayload) => void) {
  return listen<LspMessagePayload>("lsp-message", (e) => cb(e.payload));
}

export function onLspExit(cb: (payload: LspExitPayload) => void) {
  return listen<LspExitPayload>("lsp-exit", (e) => cb(e.payload));
}
