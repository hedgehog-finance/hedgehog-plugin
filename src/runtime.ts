import type { PluginRuntime } from "openclaw/plugin-sdk";

let runtime: PluginRuntime | null = null;

export function setCiweiAIRuntime(next: PluginRuntime): void {
  runtime = next;
}

export function getCiweiAIRuntime(): PluginRuntime {
  if (!runtime) {
    throw new Error("ciwei-ai runtime not initialized");
  }
  return runtime;
}
