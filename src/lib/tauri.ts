// Thin wrapper around the Tauri API so the rest of the app can stay agnostic
// about whether it is running inside the desktop shell or a plain browser.

import { invoke as rawInvoke } from '@tauri-apps/api/core';
import { listen as rawListen, type UnlistenFn } from '@tauri-apps/api/event';

export type { UnlistenFn };

/** True when running inside the Tauri shell (vs. a browser dev server). */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/** Invoke a Rust command. Throws if not running under Tauri. */
export function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return rawInvoke<T>(cmd, args);
}

/** Subscribe to a Tauri event; resolves to an unlisten function. */
export function listen<T>(
  event: string,
  handler: (payload: T) => void,
): Promise<UnlistenFn> {
  return rawListen<T>(event, (e) => handler(e.payload as T));
}
