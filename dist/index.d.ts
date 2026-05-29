declare const _default: {
    id: string;
    name: string;
    description: string;
    configSchema: import("openclaw/plugin-sdk").ChannelConfigSchema;
    register: (api: import("openclaw/plugin-sdk/channel-core").OpenClawPluginApi) => void;
    channelPlugin: import("openclaw/plugin-sdk/channel-core").ChannelPlugin<import("./src/types.js").HedgehogFinanceResolvedAccount>;
    setChannelRuntime?: (runtime: import("openclaw/plugin-sdk/channel-core").PluginRuntime) => void;
};
export default _default;
