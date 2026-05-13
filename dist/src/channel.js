import * as os from "node:os";
import * as fs from "node:fs";
import * as fsAsync from "node:fs/promises";
import * as path from "node:path";
import { WebSocket } from "ws";
import { emptyChannelConfigSchema } from "openclaw/plugin-sdk/core";
import { getHedgehogRuntime } from "./runtime.js";
import { logger } from "./core/logger.js";
import { allFeaturesTools } from "./features/index.js";
function getCurrentTimestamp() {
    return Date.now();
}
function getStateDir() {
    return process.env.OPENCLAW_STATE_DIR ||
        process.env.CLAWD_STATE_DIR ||
        path.join(os.homedir(), ".openclaw");
}
async function getSessionEntryAsync(agentId, sessionKey) {
    try {
        const stateDir = getStateDir();
        const sessionStorePath = path.join(stateDir, "agents", agentId, "sessions", "sessions.json");
        if (!fs.existsSync(sessionStorePath)) {
            return null;
        }
        const content = await fsAsync.readFile(sessionStorePath, "utf-8");
        const storeData = JSON.parse(content);
        const entry = storeData[sessionKey];
        if (!entry?.sessionId) {
            return null;
        }
        return {
            sessionId: entry.sessionId,
            inputTokens: entry.inputTokens || 0,
            outputTokens: entry.outputTokens || 0,
            totalTokens: entry.totalTokens || 0,
            cacheRead: entry.cacheRead || 0,
            cacheWrite: entry.cacheWrite || 0,
            estimatedCostUsd: entry.estimatedCostUsd || 0,
            model: entry.model,
            modelProvider: entry.modelProvider,
        };
    }
    catch (err) {
        return null;
    }
}
function toFiniteNumber(...values) {
    for (const value of values) {
        if (value === undefined || value === null || value === "")
            continue;
        const num = Number(value);
        if (Number.isFinite(num))
            return num;
    }
    return undefined;
}
function normalizeUsageSnapshot(usageRaw) {
    if (!usageRaw || typeof usageRaw !== "object" || Array.isArray(usageRaw)) {
        return null;
    }
    const inputDetails = usageRaw.input_tokens_details || usageRaw.inputTokenDetails || usageRaw.prompt_tokens_details || usageRaw.promptTokenDetails || {};
    const outputDetails = usageRaw.output_tokens_details || usageRaw.outputTokenDetails || usageRaw.completion_tokens_details || usageRaw.completionTokenDetails || {};
    const input = toFiniteNumber(usageRaw.input, usageRaw.inputTokens, usageRaw.input_tokens, usageRaw.prompt, usageRaw.promptTokens, usageRaw.prompt_tokens);
    const output = toFiniteNumber(usageRaw.output, usageRaw.outputTokens, usageRaw.output_tokens, usageRaw.completion, usageRaw.completionTokens, usageRaw.completion_tokens);
    const cacheRead = toFiniteNumber(usageRaw.cacheRead, usageRaw.cache_read, usageRaw.cachedTokens, usageRaw.cached_tokens, inputDetails.cacheRead, inputDetails.cache_read, inputDetails.cachedTokens, inputDetails.cached_tokens);
    const cacheWrite = toFiniteNumber(usageRaw.cacheWrite, usageRaw.cache_write, usageRaw.cacheCreation, usageRaw.cache_creation, inputDetails.cacheWrite, inputDetails.cache_write, inputDetails.cacheCreation, inputDetails.cache_creation);
    const reasoning = toFiniteNumber(usageRaw.reasoning, usageRaw.reasoningTokens, usageRaw.reasoning_tokens, outputDetails.reasoning, outputDetails.reasoningTokens, outputDetails.reasoning_tokens);
    const total = toFiniteNumber(usageRaw.total, usageRaw.totalTokens, usageRaw.total_tokens) ??
        (input || 0) + (output || 0) + (cacheRead || 0) + (cacheWrite || 0) + (reasoning || 0);
    const cost = toFiniteNumber(usageRaw.costUsd, usageRaw.cost_usd, usageRaw.cost, usageRaw.cost?.total, usageRaw.cost?.usd);
    return {
        input: input || 0,
        output: output || 0,
        cacheRead: cacheRead || 0,
        cacheWrite: cacheWrite || 0,
        total: total || 0,
        cost: cost || 0,
    };
}
function formatArgumentValue(value) {
    if (typeof value === "string") {
        const firstLine = value.trim().split(/\r?\n/)[0]?.trim();
        if (!firstLine)
            return;
        return firstLine.length > 240 ? `${firstLine.slice(0, 237)}...` : firstLine;
    }
    if (typeof value === "number" && Number.isFinite(value))
        return String(value);
    if (typeof value === "boolean")
        return value ? "true" : "false";
    if (Array.isArray(value)) {
        const formatted = value.map(formatArgumentValue).filter(Boolean);
        if (!formatted.length)
            return;
        const preview = formatted.slice(0, 3).join(", ");
        return formatted.length > 3 ? `${preview}, ...` : preview;
    }
    return undefined;
}
function resolveArgumentDisplay(args) {
    if (!args)
        return;
    const preferredKeys = ["command", "path", "file_path", "filePath", "url", "query", "action"];
    for (const key of preferredKeys) {
        const value = formatArgumentValue(args[key]);
        if (value)
            return value;
    }
    for (const [key, rawValue] of Object.entries(args)) {
        const value = formatArgumentValue(rawValue);
        if (value)
            return `${key} ${value}`;
    }
}
function shouldDisplayToolProgress(name) {
    if (typeof name !== "string")
        return true;
    return !new Set([
        "session_status",
        "heartbeat_respond",
        "heartbeat_response",
        "tool_call",
        "tool_call_update",
        "update_plan",
    ]).has(name);
}
async function getJsonlLineCountAsync(agentId, sessionId) {
    try {
        const stateDir = getStateDir();
        const jsonlPath = path.join(stateDir, "agents", agentId, "sessions", `${sessionId}.jsonl`);
        if (!fs.existsSync(jsonlPath)) {
            return 0;
        }
        const content = await fsAsync.readFile(jsonlPath, "utf-8");
        return content.trim().split("\n").filter(Boolean).length;
    }
    catch {
        return 0;
    }
}
async function readUsageFromJsonlAsync(agentId, sessionId, afterLine) {
    try {
        const stateDir = getStateDir();
        const jsonlPath = path.join(stateDir, "agents", agentId, "sessions", `${sessionId}.jsonl`);
        if (!fs.existsSync(jsonlPath)) {
            return null;
        }
        const content = await fsAsync.readFile(jsonlPath, "utf-8");
        const lines = content.trim().split("\n").filter(Boolean);
        for (let i = afterLine; i < lines.length; i++) {
            try {
                const entry = JSON.parse(lines[i]);
                const message = entry.message && typeof entry.message === "object" && !Array.isArray(entry.message) ? entry.message : undefined;
                if (message?.role && message.role !== "assistant")
                    continue;
                const usage = normalizeUsageSnapshot(message?.usage || entry.usage);
                if (usage) {
                    return {
                        ...usage,
                        model: message?.model || entry.model,
                        provider: message?.provider || entry.provider,
                    };
                }
            }
            catch {
                continue;
            }
        }
        return null;
    }
    catch {
        return null;
    }
}
async function getCurrentTurnUsageAsync(agentId, sessionKey, sessionIdBefore, lineCountBefore, maxRetries = 60, retryDelayMs = 100) {
    for (let attempt = 0; attempt < 40; attempt++) {
        if (attempt > 0) {
            await new Promise(r => setTimeout(r, retryDelayMs));
        }
        const entry = await getSessionEntryAsync(agentId, sessionKey);
        if (entry && entry.inputTokens > 0) {
            return {
                input: entry.inputTokens,
                output: entry.outputTokens,
                total: entry.totalTokens,
                cacheRead: entry.cacheRead,
                cacheWrite: entry.cacheWrite,
                cost: entry.estimatedCostUsd,
                model: entry.model,
                provider: entry.modelProvider,
                source: "sessions.json",
            };
        }
    }
    const entry = await getSessionEntryAsync(agentId, sessionKey);
    const sessionId = entry?.sessionId || sessionIdBefore;
    if (!sessionId) {
        return null;
    }
    for (let attempt = 0; attempt < 20; attempt++) {
        if (attempt > 0) {
            await new Promise(r => setTimeout(r, 200));
        }
        const startLine = (sessionIdBefore === sessionId) ? lineCountBefore : 0;
        const usage = await readUsageFromJsonlAsync(agentId, sessionId, startLine);
        if (usage && usage.input > 0) {
            return {
                input: usage.input,
                output: usage.output,
                total: usage.total,
                cacheRead: usage.cacheRead,
                cacheWrite: usage.cacheWrite,
                cost: usage.cost,
                model: usage.model,
                provider: usage.provider,
                source: "jsonl",
            };
        }
    }
    return null;
}
export const hedgehogFinancePlugin = {
    id: "hedgehog_finance",
    meta: {
        id: "hedgehog_finance",
        label: "Hedgehog Finance",
        selectionLabel: "Hedgehog Finance",
        blurb: "Custom WebSocket relay channel for Hedgehog App",
        docsPath: "",
        order: 100,
    },
    configSchema: emptyChannelConfigSchema(),
    capabilities: {
        chatTypes: ["direct"],
        media: false,
        reactions: false,
        threads: false,
        blockStreaming: false,
    },
    config: {
        listAccountIds: (cfg) => {
            const channelConfig = (cfg.channels?.['hedgehog_finance'] || {});
            if (channelConfig.accounts) {
                if (Array.isArray(channelConfig.accounts)) {
                    return channelConfig.accounts.map((a) => a.accountId || a.id).filter(Boolean);
                }
                return Object.keys(channelConfig.accounts);
            }
            if (channelConfig.accountId) {
                return [channelConfig.accountId];
            }
            return ["default"];
        },
        resolveAccount: (cfg, accountId) => {
            const channelConfig = (cfg.channels?.['hedgehog_finance'] || {});
            const id = accountId || channelConfig.accountId || "default";
            let accountInfo;
            if (channelConfig.accounts) {
                if (Array.isArray(channelConfig.accounts)) {
                    accountInfo = channelConfig.accounts.find((a) => (a.accountId || a.id) === id);
                }
                else {
                    accountInfo = channelConfig.accounts[id];
                }
            }
            const { accounts: _, ...defaults } = channelConfig;
            const finalConfig = { ...defaults };
            if (typeof accountInfo === "string") {
                finalConfig.token = accountInfo;
            }
            else if (accountInfo && typeof accountInfo === "object") {
                Object.assign(finalConfig, accountInfo.config || accountInfo);
            }
            const finalAccountId = finalConfig.accountId || id;
            return {
                accountId: finalAccountId,
                config: {
                    token: finalConfig.token || "",
                    code: finalConfig.code || `OpenClaw-${os.hostname()}`,
                },
                enabled: accountInfo?.enabled !== false,
                configured: Boolean(finalConfig.token),
            };
        },
        defaultAccountId: (cfg) => {
            const channelConfig = cfg?.channels?.['hedgehog_finance'];
            return channelConfig?.accountId || "default";
        },
    },
    gateway: {
        startAccount: async (ctx) => {
            const { account, cfg, log, abortSignal } = ctx;
            const rt = getHedgehogRuntime();
            const accountId = String(account.accountId);
            const childLogger = logger.child({ accountId });
            const token = account.config.token || "";
            const code = account.config.code || `OpenClaw-${os.hostname()}`;
            const relayUrl = `wss://relay.ciweiai.com/relay?id=${accountId}&token=${token}&role=provider&code=${code}`;
            let ws = null;
            let isClosing = false;
            let heartbeatInterval = null;
            const sentLengthMap = {};
            const reasoningLengthMap = {};
            const commandOutputMap = new Map();
            const toolArgumentsMap = new Map();
            const clearStreamStates = () => {
                Object.keys(sentLengthMap).forEach(k => delete sentLengthMap[k]);
                Object.keys(reasoningLengthMap).forEach(k => delete reasoningLengthMap[k]);
                commandOutputMap.clear();
                toolArgumentsMap.clear();
            };
            let resolveStop;
            const stopPromise = new Promise((resolve) => {
                resolveStop = resolve;
            });
            const stopClient = () => {
                if (isClosing)
                    return;
                isClosing = true;
                if (heartbeatInterval)
                    clearInterval(heartbeatInterval);
                clearStreamStates();
                childLogger.info("Stopping gateway...");
                try {
                    ws?.close();
                }
                catch (err) {
                    childLogger.warn({ err: err.message }, "Error during close");
                }
                ctx.setStatus({
                    ...ctx.getStatus(),
                    running: false,
                    lastStopAt: getCurrentTimestamp(),
                });
                resolveStop();
            };
            const handleInboundMessage = async (data) => {
                ctx.setStatus({
                    ...ctx.getStatus(),
                    lastEventAt: getCurrentTimestamp(),
                });
                try {
                    const appPayload = JSON.parse(data.toString());
                    if (appPayload.type === "req") {
                        const { id, method, params } = appPayload;
                        if (!method)
                            return;
                        if (method === "ping") {
                            if (ws?.readyState === WebSocket.OPEN) {
                                ws.send(JSON.stringify({
                                    type: "res",
                                    id: id,
                                    ok: true,
                                    payload: { success: true }
                                }));
                            }
                            return;
                        }
                        const tool = allFeaturesTools[method];
                        if (tool && typeof tool.execute === 'function') {
                            childLogger.debug({ method }, "拦截到 RPC 请求");
                            try {
                                const runContext = {
                                    userId: accountId,
                                    runtime: rt
                                };
                                const resultStr = await tool.execute(params, runContext);
                                const resultObj = JSON.parse(resultStr);
                                if (ws?.readyState === WebSocket.OPEN) {
                                    ws.send(JSON.stringify({
                                        type: "res",
                                        id: id,
                                        ok: true,
                                        payload: resultObj
                                    }));
                                }
                            }
                            catch (err) {
                                childLogger.error({ err: err.message, method }, "RPC 执行失败");
                                if (ws?.readyState === WebSocket.OPEN) {
                                    ws.send(JSON.stringify({
                                        type: "res",
                                        id: id,
                                        ok: false,
                                        error: { message: err.message || "RPC execution failed" }
                                    }));
                                }
                            }
                            return;
                        }
                        if (ws?.readyState === WebSocket.OPEN) {
                            ws.send(JSON.stringify({
                                type: "res",
                                id: id,
                                ok: false,
                                error: { message: `Unknown RPC method: ${method}` }
                            }));
                        }
                        return;
                    }
                    const { from, text, chatId, id } = appPayload;
                    if (!text)
                        return;
                    const route = rt.channel.routing.resolveAgentRoute({
                        cfg,
                        channel: "hedgehog_finance",
                        accountId: String(accountId),
                        peer: { kind: "direct", id: chatId },
                    });
                    const storePath = rt.channel.session.resolveStorePath(cfg.session?.store, {
                        agentId: route.agentId,
                    });
                    const sessionKey = route.sessionKey;
                    const agentId = route.agentId;
                    const entryBefore = await getSessionEntryAsync(agentId, sessionKey);
                    const sessionIdBefore = entryBefore?.sessionId || null;
                    const lineCountBefore = sessionIdBefore ? await getJsonlLineCountAsync(agentId, sessionIdBefore) : 0;
                    const context = rt.channel.reply.finalizeInboundContext({
                        Body: text,
                        From: from,
                        To: chatId,
                        SessionKey: sessionKey,
                        AccountId: route.accountId,
                        AgentId: agentId,
                        AgentWorkspace: route.agentWorkspace,
                        Provider: "hedgehog_finance",
                        MessageSid: id,
                    });
                    await rt.channel.session.recordInboundSession({
                        storePath,
                        sessionKey: context.SessionKey || sessionKey,
                        ctx: context,
                        updateLastRoute: {
                            sessionKey: route.mainSessionKey,
                            channel: "hedgehog_finance",
                            to: chatId,
                            accountId: String(accountId),
                        },
                        onRecordError: (err) => {
                            childLogger.error({ err: String(err) }, "Failed to record inbound session");
                        },
                    });
                    const startTime = Date.now();
                    const sendEvent = (type, data = {}) => {
                        if (ws?.readyState === WebSocket.OPEN) {
                            ws.send(JSON.stringify({
                                to: from,
                                chatId,
                                replyTo: id,
                                agentId,
                                fromCode: code,
                                ...data,
                                type
                            }));
                        }
                    };
                    const normalizeId = (rawId) => rawId?.replace(/^(command:|tool:|call_)/, '');
                    const replyRunId = `hedgehog:${chatId}:${id}`;
                    let hasSentModelEvent = false;
                    const sendModelEvent = (payload) => {
                        if (!payload.provider && !payload.model)
                            return;
                        if (hasSentModelEvent)
                            return;
                        hasSentModelEvent = true;
                        sendEvent("model", payload);
                    };
                    const enrichToolItemPayload = (payload) => {
                        const itemId = normalizeId(typeof payload.itemId === "string" ? payload.itemId : undefined) ||
                            (typeof payload.itemId === "string" ? payload.itemId : undefined) ||
                            `temp_${String(payload.kind || "item")}_${String(payload.title || payload.name || "unnamed")}`;
                        const toolCallId = normalizeId(typeof payload.toolCallId === "string" ? payload.toolCallId : undefined) || itemId;
                        const argumentsPayload = toolArgumentsMap.get(toolCallId) || toolArgumentsMap.get(itemId);
                        const argumentDisplay = resolveArgumentDisplay(argumentsPayload);
                        const enrichedPayload = argumentDisplay
                            ? { ...payload, arguments: argumentsPayload, title: `${payload.name || payload.kind || "tool"} ${argumentDisplay}`, meta: argumentDisplay }
                            : argumentsPayload ? { ...payload, arguments: argumentsPayload } : payload;
                        return { ...enrichedPayload, itemId, toolCallId };
                    };
                    const releaseToolArguments = (payload) => {
                        if (payload.status !== "completed" && payload.status !== "failed" && payload.status !== "blocked")
                            return;
                        const itemId = normalizeId(typeof payload.itemId === "string" ? payload.itemId : undefined);
                        const toolCallId = normalizeId(typeof payload.toolCallId === "string" ? payload.toolCallId : undefined);
                        if (itemId)
                            toolArgumentsMap.delete(itemId);
                        if (toolCallId)
                            toolArgumentsMap.delete(toolCallId);
                    };
                    const agentEventUnsubscribe = rt.events.onAgentEvent((evt) => {
                        if (evt.runId !== replyRunId)
                            return;
                        const data = evt.data || {};
                        if (evt.stream === "tool") {
                            if (!shouldDisplayToolProgress(data.name))
                                return;
                            const toolCallId = normalizeId(typeof data.toolCallId === "string" ? data.toolCallId : undefined);
                            const args = data.args && typeof data.args === "object" && !Array.isArray(data.args)
                                ? data.args
                                : undefined;
                            if (toolCallId && args) {
                                toolArgumentsMap.set(toolCallId, args);
                                toolArgumentsMap.set(`tool:${toolCallId}`, args);
                                toolArgumentsMap.set(`command:${toolCallId}`, args);
                            }
                            const eventArgs = args || (toolCallId ? toolArgumentsMap.get(toolCallId) : undefined);
                            sendEvent("tool_event", {
                                phase: data.phase,
                                name: data.name,
                                toolCallId: toolCallId || data.toolCallId,
                                arguments: eventArgs,
                                meta: data.meta,
                                isError: data.isError,
                            });
                            return;
                        }
                        if (evt.stream === "item") {
                            if (!shouldDisplayToolProgress(data.name))
                                return;
                            if (data.kind === "tool" && (data.name === "exec" || data.name === "bash"))
                                return;
                            const enrichedPayload = enrichToolItemPayload(data);
                            sendEvent("item_event", enrichedPayload);
                            releaseToolArguments(data);
                            return;
                        }
                        if (evt.stream === "command_output") {
                            const itemId = normalizeId(typeof data.itemId === "string" ? data.itemId :
                                typeof data.toolCallId === "string" ? data.toolCallId : "global") || "global";
                            const last = commandOutputMap.get(itemId) || "";
                            const output = typeof data.output === "string" ? data.output : "";
                            const full = data.phase === "delta" || data.phase === "update" ? last + output : output;
                            commandOutputMap.set(itemId, full);
                            if (output || data.exitCode !== undefined || data.status === "completed") {
                                sendEvent("command_output", { ...data, output: full, itemId, toolCallId: itemId });
                            }
                            return;
                        }
                        if (evt.stream === "patch") {
                            const itemId = normalizeId(typeof data.itemId === "string" ? data.itemId : undefined) || "patch";
                            sendEvent("patch_summary", { ...data, itemId, toolCallId: itemId });
                        }
                    });
                    const sendFinalReplyAndUsage = async () => {
                        const durationMs = Date.now() - startTime;
                        if (ws?.readyState !== WebSocket.OPEN)
                            return;
                        ws.send(JSON.stringify({
                            type: "reply",
                            to: from,
                            chatId: chatId,
                            replyTo: id,
                            isFinal: true,
                            fromCode: code
                        }));
                        const turnUsage = await getCurrentTurnUsageAsync(agentId, sessionKey, sessionIdBefore, lineCountBefore);
                        if (ws?.readyState !== WebSocket.OPEN)
                            return;
                        sendModelEvent({
                            provider: turnUsage?.provider,
                            model: turnUsage?.model,
                        });
                        ws.send(JSON.stringify({
                            type: "usage",
                            to: from,
                            chatId: chatId,
                            replyTo: id,
                            usage: {
                                input: turnUsage?.input || 0,
                                output: turnUsage?.output || 0,
                                total: turnUsage?.total || 0,
                                cacheRead: turnUsage?.cacheRead || 0,
                                cacheWrite: turnUsage?.cacheWrite || 0,
                            },
                            costUsd: turnUsage?.cost || 0,
                            durationMs: durationMs,
                            model: turnUsage?.model,
                            provider: turnUsage?.provider,
                            usageAvailable: Boolean(turnUsage),
                            usageSource: turnUsage?.source || "unavailable",
                            usageDebug: turnUsage ? undefined : {
                                agentId,
                                sessionKey,
                                sessionIdBefore,
                                lineCountBefore,
                                stateDir: getStateDir()
                            },
                            fromCode: code
                        }));
                    };
                    const replyOpts = {
                        runId: replyRunId,
                        verboseLevel: 'full',
                        shouldEmitToolResult: true,
                        shouldEmitToolOutput: true,
                        onPartialReply: (payload) => {
                            if (payload.text) {
                                const prev = sentLengthMap[chatId] || 0;
                                const delta = payload.text.slice(prev);
                                sentLengthMap[chatId] = payload.text.length;
                                if (delta)
                                    sendEvent("reply", { text: delta, isPartial: true });
                            }
                        },
                        onReasoningStream: (payload) => {
                            if (payload.text) {
                                const prev = reasoningLengthMap[chatId] || 0;
                                const delta = payload.text.slice(prev);
                                reasoningLengthMap[chatId] = payload.text.length;
                                if (delta)
                                    sendEvent("reasoning", { text: delta });
                            }
                        },
                        onReasoningEnd: () => sendEvent("reasoning_end"),
                        onAssistantMessageStart: () => {
                            sentLengthMap[chatId] = 0;
                            reasoningLengthMap[chatId] = 0;
                            sendEvent("assistant_message_start");
                        },
                        onModelSelected: (payload) => {
                            sendModelEvent(payload);
                        },
                    };
                    // Relay clients depend on verbose stream events for tool progress.
                    const finalCfg = {
                        ...cfg,
                        agents: {
                            ...cfg.agents,
                            defaults: {
                                ...(cfg.agents?.defaults || {}),
                                verboseDefault: 'full'
                            }
                        }
                    };
                    const finalReplyOpts = { ...replyOpts };
                    try {
                        await rt.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
                            cfg: finalCfg,
                            ctx: context,
                            replyOptions: finalReplyOpts,
                            dispatcherOptions: {
                                deliver: async (payload, info) => {
                                    const cd = payload.channelData;
                                    if (cd && (cd.toolCallId || cd.itemId)) {
                                        sendEvent("tool_result", {
                                            ...payload,
                                            toolCallId: normalizeId(String(cd.toolCallId || cd.itemId || ""))
                                        });
                                    }
                                },
                            }
                        });
                        await sendFinalReplyAndUsage();
                    }
                    finally {
                        agentEventUnsubscribe();
                        delete sentLengthMap[chatId];
                        delete reasoningLengthMap[chatId];
                    }
                }
                catch (err) {
                    childLogger.error({ err: err.message }, "Dispatch error");
                }
            };
            const connect = () => {
                if (isClosing)
                    return;
                childLogger.debug({ relayUrl }, "Connecting to relay");
                ws = new WebSocket(relayUrl);
                ws.on("open", () => {
                    childLogger.info({ code }, "Connected");
                    ctx.setStatus({
                        ...ctx.getStatus(),
                        running: true,
                        lastStartAt: getCurrentTimestamp(),
                        lastEventAt: getCurrentTimestamp(),
                        lastError: null,
                    });
                    if (heartbeatInterval)
                        clearInterval(heartbeatInterval);
                    heartbeatInterval = setInterval(() => {
                        if (ws?.readyState === WebSocket.OPEN) {
                            ws.ping();
                        }
                    }, 30000);
                });
                ws.on("message", handleInboundMessage);
                ws.on("error", (err) => {
                    childLogger.error({ err: err.message }, "WebSocket error");
                    ctx.setStatus({
                        ...ctx.getStatus(),
                        lastError: `Connection error: ${err.message}`,
                    });
                });
                ws.on("close", (closeCode, reason) => {
                    if (heartbeatInterval)
                        clearInterval(heartbeatInterval);
                    clearStreamStates();
                    if (!isClosing) {
                        const retryDelay = 5000 + Math.random() * 5000;
                        childLogger.warn({ closeCode, retryDelay: Math.round(retryDelay / 1000) }, "Connection dropped. Retrying...");
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
                log?.info?.(`[hedgehog-app][${accountId}] Abort signal received`);
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
        collectStatusIssues: (accounts) => {
            return accounts.flatMap((account) => {
                if (!account.configured) {
                    return [
                        {
                            channel: "hedgehog_finance",
                            accountId: account.accountId,
                            kind: "config",
                            message: "Account not configured (missing relay token)",
                        },
                    ];
                }
                return [];
            });
        },
        buildChannelSummary: ({ snapshot }) => ({
            configured: snapshot?.configured ?? false,
            running: snapshot?.running ?? false,
            lastStartAt: snapshot?.lastStartAt ?? null,
            lastStopAt: snapshot?.lastStopAt ?? null,
            lastError: snapshot?.lastError ?? null,
        }),
        probeAccount: async ({ account }) => {
            if (!account.configured || !account.config?.token) {
                return { ok: false, error: "Token not configured" };
            }
            return { ok: true, details: { relay: "wss://relay.ciweiai.com/relay" } };
        },
        buildAccountSnapshot: ({ account, runtime, snapshot, probe }) => {
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
//# sourceMappingURL=channel.js.map