import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import { ciweiAIPlugin } from "./src/channel";
import { setCiweiAIRuntime } from "./src/runtime";

/**
 * ciweiAI
 */
const plugin: any = {
  id: "ciwei-ai",
  name: "ciwei AI Channel",
  description: "Custom WebSocket-based channel for Ciwei AI",
  configSchema: emptyPluginConfigSchema(),

  register(api: OpenClawPluginApi): void {
    console.log("[ciwei-ai] Registering plugin...");
    setCiweiAIRuntime(api.runtime);

    api.registerChannel({ plugin: ciweiAIPlugin });

    // api.registerGatewayMethod("ciweiai.some.method", async (...) => { ... });
  },
};

export default plugin;
