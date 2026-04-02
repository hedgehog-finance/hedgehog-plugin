import * as os from "node:os";
import { WebSocket } from "ws";
import { z } from "zod";
import { buildChannelConfigSchema } from "openclaw/plugin-sdk";
import {
    ChannelPlugin,
    OpenClawConfig,
    ChannelGatewayContext,
    ChannelAccountSnapshot,
    ChannelStatusIssue
} from "openclaw/plugin-sdk";
import { getCiweiAIRuntime } from "./runtime";
import type {
    CiweiAIResolvedAccount,
    RelayInboundMessage,
    RelayReplyMessage
} from "./types";


/**
 * Ciwei AI  Schema
 *  accountId , token
 */
const CiweiAIConfigSchema = z.object({
    token: z.string().describe("Relay server access token").optional(),
    accountId: z.string().describe("Relay server account ID").optional(),
    code: z.string().describe("Unique code for this connection").optional(),
});

/**
 * Unix
 */
function getCurrentTimestamp(): number {
    return Date.now();
}

/**
 * Ciwei AI Channel Plugin
 * accountId + token
 *
 * "ciwei-ai": {
 *   "enabled": true,
 *   "accountId": "13333333333",
 *   "token": "your-token"
 * }
 */
export const ciweiAIPlugin: ChannelPlugin<CiweiAIResolvedAccount> = {
    id: "ciwei-ai",

    meta: {
        id: "ciwei-ai",
        label: "Ciwei AI",
        selectionLabel: "Ciwei AI",
        blurb: "Custom WebSocket relay channel for Ciwei AI",
        docsPath: "/channels/ciwei-ai",
        order: 100,
    },

    configSchema: buildChannelConfigSchema(CiweiAIConfigSchema),

    capabilities: {
        chatTypes: ["direct"],
        media: false,
        reactions: false,
        threads: false,
        blockStreaming: true,
    },

    config: {
        listAccountIds: (cfg: OpenClawConfig): string[] => {
            const channelConfig = (cfg.channels?.['ciwei-ai'] || {}) as any;
            
            if (channelConfig.accounts) {
                if (Array.isArray(channelConfig.accounts)) {
                    return channelConfig.accounts.map((a: any) => a.accountId || a.id).filter(Boolean);
                }
                return Object.keys(channelConfig.accounts);
            }

            if (channelConfig.accountId) {
                return [channelConfig.accountId];
            }

            return ["default"];
        },

        resolveAccount: (cfg: OpenClawConfig, accountId?: string | null): CiweiAIResolvedAccount => {
            const channelConfig = (cfg.channels?.['ciwei-ai'] || {}) as any;
            const id = accountId || channelConfig.accountId || "default";

            let accountInfo: any;
            if (channelConfig.accounts) {
                if (Array.isArray(channelConfig.accounts)) {
                    accountInfo = channelConfig.accounts.find((a: any) => (a.accountId || a.id) === id);
                } else {
                    accountInfo = channelConfig.accounts[id];
                }
            }

            // Defaults from top-level
            const { accounts: _, ...defaults } = channelConfig;
            
            const finalConfig: any = { ...defaults };
            if (typeof accountInfo === "string") {
                finalConfig.token = accountInfo;
            } else if (accountInfo && typeof accountInfo === "object") {
                Object.assign(finalConfig, accountInfo.config || accountInfo);
            }

            const finalAccountId = finalConfig.accountId || id;

            return {
                accountId: finalAccountId,
                config: {
                    token: finalConfig.token,
                    code: finalConfig.code,
                },
                enabled: accountInfo?.enabled !== false,
                configured: Boolean(finalConfig.token),
            };
        },

        defaultAccountId: (cfg: OpenClawConfig): string => {
            const channelConfig = (cfg as any)?.channels?.['ciwei-ai'];
            return channelConfig?.accountId || "default";
        },
    },

    gateway: {
        startAccount: async (ctx: ChannelGatewayContext<CiweiAIResolvedAccount>) => {
            const { account, cfg, log, abortSignal } = ctx;
            const rt = getCiweiAIRuntime();
            const accountId = String(account.accountId);
            const token = account.config.token || "";
            const code = account.config.code || `OpenClaw-${os.hostname()}`;
            const relayUrl = `wss://relay.ciweiai.com/relay?id=${accountId}&token=${token}&role=provider&code=${code}`;

            let ws: WebSocket | null = null;
            let isClosing = false;
            let heartbeatInterval: NodeJS.Timeout | null = null;

            // 用于阻塞 startAccount 的生命周期
            let resolveStop: (value: void | PromiseLike<void>) => void;
            const stopPromise = new Promise<void>((resolve) => {
                resolveStop = resolve;
            });

            const stopClient = () => {
                if (isClosing) return;
                isClosing = true;

                if (heartbeatInterval) clearInterval(heartbeatInterval);
                log?.info?.(`[ciwei-ai][${accountId}] Stopping gateway...`);

                try {
                    ws?.close();
                } catch (err: any) {
                    log?.warn?.(`[ciwei-ai][${accountId}] Error during close: ${err.message}`);
                }

                ctx.setStatus({
                    ...ctx.getStatus(),
                    running: false,
                    lastStopAt: getCurrentTimestamp(),
                });

                resolveStop();
            };

            const connect = () => {
                if (isClosing) return;

                log?.debug?.(`[ciwei-ai][${accountId}] Connecting to relay: ${relayUrl}`);
                ws = new WebSocket(relayUrl);

                ws.on("open", () => {
                    log?.info?.(`[ciwei-ai][${accountId}] Connected (Role: Provider, Code: ${code})`);
                    ctx.setStatus({
                        ...ctx.getStatus(),
                        running: true,
                        lastStartAt: getCurrentTimestamp(),
                        lastEventAt: getCurrentTimestamp(),
                        lastError: null,
                    });

                    if (heartbeatInterval) clearInterval(heartbeatInterval);
                    heartbeatInterval = setInterval(() => {
                        if (ws?.readyState === WebSocket.OPEN) {
                            ws.ping();
                        }
                    }, 30000);
                });

                const sentLengthMap: Record<string, number> = {};       // 正式回复流的已发送长度
                const reasoningLengthMap: Record<string, number> = {};  // 思考流的已发送长度

                // 优化：预先计算并缓存 Streaming 配置，避免每条消息都执行对象克隆与解析
                const streamingCfg = JSON.parse(JSON.stringify(cfg));
                streamingCfg.channels = streamingCfg.channels || {};
                streamingCfg.channels['ciwei-ai'] = streamingCfg.channels['ciwei-ai'] || {};
                streamingCfg.channels['ciwei-ai'].blockStreaming = true;
                streamingCfg.channels['ciwei-ai'].streaming = "block";
                streamingCfg.agents = streamingCfg.agents || {};
                streamingCfg.agents.defaults = streamingCfg.agents.defaults || {};
                streamingCfg.agents.defaults.blockStreamingDefault = "on";
                streamingCfg.agents.defaults.blockStreamingBreak = "text_end";

                ws.on("message", async (data) => {
                    ctx.setStatus({
                        ...ctx.getStatus(),
                        lastEventAt: getCurrentTimestamp(),
                    });

                    try {
                        const appPayload: RelayInboundMessage = JSON.parse(data.toString());
                        const { from, text, chatId, id } = appPayload;

                        if (!text) return;

                        const route = rt.channel.routing.resolveAgentRoute({
                            cfg,
                            channel: "ciwei-ai",
                            accountId: String(accountId),
                            peer: { kind: "direct", id: chatId },
                        });
                        const context = rt.channel.reply.finalizeInboundContext({
                            Body: text,
                            From: from,
                            To: chatId,
                            SessionKey: route.sessionKey,
                            AccountId: route.accountId,
                            AgentId: route.agentId,
                            AgentWorkspace: (route as any).agentWorkspace,
                            Provider: "ciwei-ai",
                            MessageSid: id,
                        });

                        await rt.channel.session.recordInboundSession({
                            storePath: rt.channel.session.resolveStorePath(cfg.session?.store, {
                                agentId: route.agentId,
                            }),
                            sessionKey: context.SessionKey || route.sessionKey,
                            ctx: context,
                            updateLastRoute: {
                                sessionKey: route.mainSessionKey,
                                channel: "ciwei-ai",
                                to: chatId,
                                accountId: String(accountId),
                            },
                            onRecordError: (err: unknown) => {
                                log?.error?.(`[ciwei-ai][${accountId}] Failed to record inbound session: ${String(err)}`);
                            },
                        });

                        await rt.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
                            ctx: context,
                            cfg: streamingCfg, // 使用缓存的配置
                            dispatcherOptions: {
                                deliver: async (payload: any) => {
                                    if (ws?.readyState === WebSocket.OPEN) {
                                        ws.send(JSON.stringify({
                                            type: "reply",
                                            to: from,
                                            chatId: chatId,
                                            replyTo: id,
                                            isFinal: true,
                                            fromCode: code
                                        }));
                                    }
                                    delete sentLengthMap[chatId];
                                }
                            },
                            replyOptions: {
                                onPartialReply: (payload: any) => {
                                    if (payload.text && ws?.readyState === WebSocket.OPEN) {
                                        const prev = sentLengthMap[chatId] || 0;
                                        const delta = payload.text.slice(prev);
                                        sentLengthMap[chatId] = payload.text.length;
                                        if (delta) {
                                            ws.send(JSON.stringify({
                                                type: "reply",
                                                to: from,
                                                chatId: chatId,
                                                text: delta,
                                                replyTo: id,
                                                isPartial: true,
                                                fromCode: code
                                            }));
                                        }
                                    }
                                },
                                onReasoningStream: (payload: any) => {
                                    // 思考流使用独立计数器，与正文流互不干扰
                                    if (payload.text && ws?.readyState === WebSocket.OPEN) {
                                        const prev = reasoningLengthMap[chatId] || 0;
                                        const delta = payload.text.slice(prev);
                                        reasoningLengthMap[chatId] = payload.text.length;
                                        if (delta) {
                                            ws.send(JSON.stringify({
                                                type: "reply",
                                                to: from,
                                                chatId: chatId,
                                                text: delta,
                                                replyTo: id,
                                                isPartial: true,
                                                isThinking: true,  // 标记为思考内容，前端可选择忽略或单独展示
                                                fromCode: code
                                            }));
                                        }
                                    }
                                }
                            }
                        });
                    } catch (err: any) {
                        log?.error?.(`[ciwei-ai][${accountId}] Dispatch error: ${err.message}`);
                    }
                });

                ws.on("error", (err) => {
                    log?.error?.(`[ciwei-ai][${accountId}] WebSocket error: ${err.message}`);
                    ctx.setStatus({
                        ...ctx.getStatus(),
                        lastError: `Connection error: ${err.message}`,
                    });
                });

                ws.on("close", (code, reason) => {
                    if (heartbeatInterval) clearInterval(heartbeatInterval);
                    if (!isClosing) {
                        // 优化：加入随机抖动 (Jitter)，防止大规模实例同时断线后产生的惊群效应 (Thundering Herd)
                        const retryDelay = 5000 + Math.random() * 5000;
                        log?.warn?.(`[ciwei-ai][${accountId}] Connection dropped (code=${code}). Retrying in ${Math.round(retryDelay/1000)}s...`);
                        ctx.setStatus({
                            ...ctx.getStatus(),
                            running: false,
                        });
                        setTimeout(connect, retryDelay);
                    }
                });
            };

            connect();

            abortSignal?.addEventListener("abort", () => {
                log?.info?.(`[ciwei-ai][${accountId}] Abort signal received`);
                stopClient();
            });

            await stopPromise;

            return {
                stop: () => {
                    stopClient();
                },
            };
        }
    },

    status: {
        defaultRuntime: {
            accountId: "default",
            running: false,
            lastEventAt: null,
            lastStartAt: null,
            lastStopAt: null,
            lastError: null,
        },
        collectStatusIssues: (accounts: ChannelAccountSnapshot[]): ChannelStatusIssue[] => {
            return accounts.flatMap((account) => {
                if (!account.configured) {
                    return [
                        {
                            channel: "ciwei-ai",
                            accountId: account.accountId,
                            kind: "config" as const,
                            message: "Account not configured (missing relay token)",
                        },
                    ];
                }
                return [];
            });
        },
        buildChannelSummary: ({ snapshot }: { snapshot: ChannelAccountSnapshot }) => ({
            configured: snapshot?.configured ?? false,
            running: snapshot?.running ?? false,
            lastStartAt: snapshot?.lastStartAt ?? null,
            lastStopAt: snapshot?.lastStopAt ?? null,
            lastError: snapshot?.lastError ?? null,
        }),
        probeAccount: async ({ account }: { account: CiweiAIResolvedAccount }) => {
            if (!account.configured || !account.config?.token) {
                return { ok: false, error: "Token not configured" };
            }
            return { ok: true, details: { relay: "wss://relay.ciweiai.com/relay" } };
        },
        buildAccountSnapshot: ({ account, runtime, snapshot, probe }: {
            account: CiweiAIResolvedAccount,
            runtime?: ChannelAccountSnapshot,
            snapshot?: ChannelAccountSnapshot,
            probe?: any
        }): ChannelAccountSnapshot => {
            const running = runtime?.running ?? snapshot?.running ?? false;
            return {
                ...snapshot,
                accountId: account.accountId,
                enabled: account.enabled,
                configured: account.configured,
                running,
                lastEventAt: runtime?.lastEventAt ?? snapshot?.lastEventAt ?? null,
                lastStartAt: runtime?.lastStartAt ?? snapshot?.lastStartAt ?? null,
                lastStopAt: runtime?.lastStopAt ?? snapshot?.lastStopAt ?? null,
                lastError: runtime?.lastError ?? snapshot?.lastError ?? null,
                probe,
            };
        },
    },
};
