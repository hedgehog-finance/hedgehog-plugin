import * as os from "node:os";
import * as fs from "node:fs";
import * as fsAsync from "node:fs/promises";
import * as path from "node:path";
import { WebSocket } from "ws";
import { emptyChannelConfigSchema } from "openclaw/plugin-sdk/core";
import { isReasoningReplyPayload } from "openclaw/plugin-sdk/reply-payload";
import { getHedgehogRuntime } from "./runtime.js";
import { logger } from "./core/logger.js";
import { getDB } from "./core/database.js";
import { allFeaturesTools } from "./features/index.js";
import { saveStockAiAnalysisRecord } from "./features/stockAnalysis/tools.js";
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
const THINKING_TAG_NAME = String.raw `(?:(?:antml:)?(?:think(?:ing)?|thought)|antthinking)`;
function stripThinkingTaggedText(text) {
    const completeThinkingTag = new RegExp(String.raw `<\s*${THINKING_TAG_NAME}\s*>[\s\S]*?<\s*\/\s*${THINKING_TAG_NAME}\s*>`, "gi");
    const danglingThinkingTag = new RegExp(String.raw `<\s*${THINKING_TAG_NAME}\s*>[\s\S]*$`, "i");
    return text
        .replace(completeThinkingTag, "")
        .replace(danglingThinkingTag, "");
}
function extractThinkingTaggedText(text) {
    const completeThinkingTag = new RegExp(String.raw `<\s*${THINKING_TAG_NAME}\s*>([\s\S]*?)<\s*\/\s*${THINKING_TAG_NAME}\s*>`, "gi");
    const parts = [];
    for (const match of text.matchAll(completeThinkingTag)) {
        const thinking = match[1]?.trim();
        if (thinking)
            parts.push(thinking);
    }
    return parts.join("\n").trim();
}
function extractVisibleReplyText(rawText) {
    let text = stripThinkingTaggedText(rawText);
    const finalOpen = /<\s*final\s*>/i.exec(text);
    if (finalOpen) {
        text = text.slice((finalOpen.index || 0) + finalOpen[0].length);
    }
    const finalClose = /<\s*\/\s*final\s*>/i.exec(text);
    if (finalClose) {
        text = text.slice(0, finalClose.index);
    }
    return text
        .replace(/<\s*\/?\s*final\s*>/gi, "")
        .replace(/^\s+/, "");
}
function buildReplyTextDelta(state, rawText, replace) {
    const visibleText = extractVisibleReplyText(rawText);
    if (!visibleText)
        return "";
    if (state.text && !visibleText.startsWith(state.text)) {
        const delta = visibleText === state.text ? "" : visibleText;
        state.text = visibleText;
        return delta;
    }
    const delta = visibleText.slice(state.text.length);
    state.text = visibleText;
    return delta;
}
function isReasoningPayload(payload, info) {
    if (info?.isReasoning === true)
        return true;
    if (!payload || typeof payload !== "object")
        return false;
    return isReasoningReplyPayload(payload);
}
function parseStockAnalysisRequest(text, chatId) {
    let body;
    try {
        body = JSON.parse(text);
    }
    catch {
        return null;
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
        return null;
    }
    const payload = body;
    const cwContent = typeof payload.cw_content === "string" ? payload.cw_content.trim() : "";
    let stock_code = "";
    let stock_name = "";
    // 1. Try parsing cw_context if it exists
    const cwContext = typeof payload.cw_context === "string" ? payload.cw_context.trim() : "";
    if (cwContext) {
        try {
            const parsedContext = JSON.parse(cwContext);
            if (parsedContext && typeof parsedContext === "object" && !Array.isArray(parsedContext)) {
                if (parsedContext.saveMode === "tool")
                    return null;
                stock_code = typeof parsedContext.stock_code === "string" ? parsedContext.stock_code.trim() : "";
                stock_name = typeof parsedContext.stock_name === "string" ? parsedContext.stock_name.trim() : "";
            }
        }
        catch {
            // If not a valid JSON string, treat cwContext as the plain stock_code
            stock_code = cwContext;
        }
    }
    // 2. If we found a stock_code but no stock_name, attempt database lookups
    if (stock_code && !stock_name) {
        try {
            const db = getDB();
            const normalizedCode = stock_code.toUpperCase().replace(/\.SS$/i, ".SH");
            // Query stock classification cache first
            let row = db.prepare(`SELECT stock_name FROM stock_classification_cache WHERE stock_code = ? OR stock_code = ? LIMIT 1`)
                .get(normalizedCode, normalizedCode.replace(/\.SH$/i, "").replace(/\.SZ$/i, "").replace(/\.HK$/i, ""));
            if (!row) {
                // Fallback to watchlist
                row = db.prepare(`SELECT stock_name FROM watchlist WHERE stock_code = ? LIMIT 1`)
                    .get(normalizedCode);
            }
            if (row?.stock_name) {
                stock_name = row.stock_name;
            }
            else {
                stock_name = stock_code; // fallback to code if name not found in db
            }
        }
        catch {
            stock_name = stock_code;
        }
    }
    // 3. Fallback to legacy cwContent/chatId parsing if no stock_code was found via cw_context
    if (!stock_code) {
        if (!cwContent.startsWith("分析一下") || !cwContent.endsWith("股票")) {
            return null;
        }
        const chatIdMatch = typeof chatId === "string"
            ? /^stock_analysis_(.+)_\d+$/.exec(chatId)
            : null;
        stock_code = typeof payload.cw_stock_code === "string"
            ? payload.cw_stock_code.trim()
            : chatIdMatch?.[1]?.trim() || "";
        stock_name = typeof payload.cw_stock_name === "string"
            ? payload.cw_stock_name.trim()
            : cwContent.replace(/^分析一下/, "").replace(/股票$/, "").trim();
    }
    const market = typeof payload.cw_market === "string" && payload.cw_market.trim()
        ? payload.cw_market.trim()
        : "CN";
    if (!stock_code || !stock_name) {
        return null;
    }
    return { stock_code, stock_name, market };
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
        blockStreaming: true,
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
            const replyTextStateMap = {};
            const reasoningLengthMap = {};
            const taggedThinkingStateMap = {};
            const commandOutputMap = new Map();
            const toolArgsMap = new Map();
            const clearStreamStates = () => {
                Object.keys(replyTextStateMap).forEach(k => delete replyTextStateMap[k]);
                Object.keys(reasoningLengthMap).forEach(k => delete reasoningLengthMap[k]);
                Object.keys(taggedThinkingStateMap).forEach(k => delete taggedThinkingStateMap[k]);
                commandOutputMap.clear();
                toolArgsMap.clear();
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
                    let agentId = route.agentId;
                    let sessionKey = route.sessionKey;
                    let agentWorkspace = route.agentWorkspace;
                    if (chatId && chatId.startsWith("main")) {
                        agentId = "main";
                        sessionKey = rt.channel.routing.buildAgentSessionKey({
                            agentId: "main",
                            channel: "hedgehog_finance",
                            accountId: String(accountId),
                            peer: { kind: "direct", id: chatId },
                        });
                        const agentList = (cfg.agents?.list || []);
                        const mainAgent = agentList.find((a) => a.id === "main") || agentList[0];
                        agentWorkspace = mainAgent?.workspace ||
                            cfg.agents?.defaults?.workspace ||
                            path.join(os.homedir(), ".openclaw", "hedgehog-workspace");
                    }
                    const storePath = rt.channel.session.resolveStorePath(cfg.session?.store, {
                        agentId: agentId,
                    });
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
                        AgentWorkspace: agentWorkspace,
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
                    const sendReasoningText = (text) => {
                        if (!text)
                            return;
                        const prev = reasoningLengthMap[chatId] || 0;
                        const delta = text.slice(prev);
                        reasoningLengthMap[chatId] = text.length;
                        if (delta)
                            sendEvent("reasoning", { text: delta });
                    };
                    const sendReasoningDelta = (text) => {
                        if (!text)
                            return;
                        reasoningLengthMap[chatId] = (reasoningLengthMap[chatId] || 0) + text.length;
                        sendEvent("reasoning", { text });
                    };
                    const sendTaggedThinkingText = (rawText) => {
                        const thinkingText = extractThinkingTaggedText(rawText);
                        if (!thinkingText)
                            return;
                        const state = taggedThinkingStateMap[chatId] ||= { text: "" };
                        const delta = state.text && thinkingText.startsWith(state.text)
                            ? thinkingText.slice(state.text.length)
                            : thinkingText;
                        state.text = thinkingText;
                        if (delta)
                            sendEvent("reasoning", { text: delta });
                    };
                    const sendReplyText = (payload) => {
                        const rawText = typeof payload.text === "string" ? payload.text : typeof payload.delta === "string" ? payload.delta : "";
                        if (!rawText)
                            return;
                        sendTaggedThinkingText(rawText);
                        const state = replyTextStateMap[chatId] ||= { text: "" };
                        if (payload.replace) {
                            const visibleText = extractVisibleReplyText(rawText);
                            if (!visibleText)
                                return;
                            state.text = visibleText;
                            sendEvent("reply", { text: visibleText, isPartial: true, replace: true });
                            return;
                        }
                        const delta = typeof payload.delta === "string" && !payload.replace
                            ? extractVisibleReplyText(payload.delta)
                            : buildReplyTextDelta(state, rawText, payload.replace);
                        if (!delta)
                            return;
                        if (typeof payload.delta === "string" && !payload.replace) {
                            state.text += delta;
                        }
                        sendEvent("reply", { text: delta, isPartial: true });
                    };
                    const stockAnalysisRequest = parseStockAnalysisRequest(text, chatId);
                    let stockAnalysisReplyText = "";
                    let didSaveStockAnalysis = false;
                    const appendStockAnalysisReplyText = (content) => {
                        if (!stockAnalysisRequest)
                            return;
                        const visibleContent = extractVisibleReplyText(content);
                        if (!visibleContent)
                            return;
                        if (!stockAnalysisReplyText || visibleContent.startsWith(stockAnalysisReplyText)) {
                            stockAnalysisReplyText = visibleContent;
                            return;
                        }
                        if (stockAnalysisReplyText.includes(visibleContent))
                            return;
                        stockAnalysisReplyText += visibleContent;
                    };
                    const saveStockAnalysisReply = (content) => {
                        if (!stockAnalysisRequest || didSaveStockAnalysis)
                            return;
                        appendStockAnalysisReplyText(content);
                        const visibleContent = stockAnalysisReplyText.trim();
                        if (!visibleContent)
                            return;
                        try {
                            saveStockAiAnalysisRecord(getDB(), accountId, {
                                ...stockAnalysisRequest,
                                sessionId: appPayload.sessionId || appPayload.params?.sessionId || "",
                                content: visibleContent
                            });
                            didSaveStockAnalysis = true;
                        }
                        catch (err) {
                            const message = err?.message || "保存股票 AI 分析失败";
                            childLogger.error({ err: message, chatId, stock_code: stockAnalysisRequest.stock_code }, "保存股票 AI 分析失败");
                            sendEvent("error", { error: message });
                            throw err;
                        }
                    };
                    const normalizeId = (rawId) => rawId?.replace(/^(command:|tool:|call_)/, '');
                    let hasSentModelEvent = false;
                    const sendModelEvent = (payload) => {
                        if (!payload.provider && !payload.model)
                            return;
                        if (hasSentModelEvent)
                            return;
                        hasSentModelEvent = true;
                        sendEvent("model", payload);
                    };
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
                        suppressDefaultToolProgressMessages: true,
                        disableBlockStreaming: false,
                        onPartialReply: (payload) => {
                            if (isReasoningPayload(payload)) {
                                if (typeof payload.delta === "string")
                                    sendReasoningDelta(payload.delta);
                                else if (typeof payload.text === "string")
                                    sendReasoningText(payload.text);
                            }
                        },
                        onReasoningStream: (payload) => {
                            if (payload.text) {
                                sendReasoningText(payload.text);
                            }
                        },
                        onReasoningEnd: () => sendEvent("reasoning_end"),
                        onAssistantMessageStart: () => {
                            replyTextStateMap[chatId] = { text: "" };
                            reasoningLengthMap[chatId] = 0;
                            taggedThinkingStateMap[chatId] = { text: "" };
                            sendEvent("assistant_message_start");
                        },
                        onModelSelected: (payload) => {
                            sendModelEvent(payload);
                        },
                        onToolStart: (payload) => {
                            const rawId = payload.itemId || payload.toolCallId;
                            const itemId = normalizeId(rawId || '');
                            const hasArgs = Boolean(payload.args && Object.keys(payload.args).length > 0);
                            if (!hasArgs && payload.phase !== "start") {
                                return;
                            }
                            if (!itemId) {
                                sendEvent("tool_start", payload);
                                return;
                            }
                            toolArgsMap.set(itemId, { name: payload.name, args: payload.args });
                            sendEvent("tool_start", { ...payload, itemId, toolCallId: itemId });
                        },
                        onItemEvent: (payload) => {
                            const rawId = payload.itemId || payload.toolCallId;
                            const itemId = normalizeId(rawId || `temp_${payload.kind || 'item'}_${payload.title || payload.name || 'unnamed'}`);
                            const startedTool = itemId ? toolArgsMap.get(itemId) : undefined;
                            const isCommandEvent = payload.kind === "command" || payload.name === "exec";
                            sendEvent("item_event", {
                                ...payload,
                                name: payload.name || startedTool?.name,
                                args: startedTool?.args,
                                progressText: isCommandEvent ? undefined : payload.progressText,
                                summary: isCommandEvent ? undefined : payload.summary,
                                itemId,
                                toolCallId: itemId,
                            });
                        },
                        onCommandOutput: (payload) => {
                            const itemId = normalizeId(payload.itemId || payload.toolCallId || 'global');
                            const last = commandOutputMap.get(itemId) || "";
                            const output = payload.output || "";
                            const full = payload.phase === 'delta'
                                ? (output.startsWith(last) ? output : last + output)
                                : output;
                            commandOutputMap.set(itemId, full);
                            if (payload.output || payload.exitCode !== undefined || payload.status === 'completed') {
                                sendEvent("command_output", { ...payload, output: full, itemId });
                            }
                        }
                    };
                    const finalCfg = {
                        ...cfg,
                        agents: {
                            ...cfg.agents,
                            defaults: {
                                ...(cfg.agents?.defaults || {}),
                                verboseDefault: 'off',
                                blockStreamingDefault: 'on',
                                blockStreamingBreak: 'text_end',
                                blockStreamingChunk: {
                                    minChars: 24,
                                    maxChars: 160,
                                    breakPreference: 'sentence',
                                },
                                blockStreamingCoalesce: {
                                    minChars: 24,
                                    maxChars: 160,
                                    idleMs: 120,
                                },
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
                                    if ((info.kind === "final" || info.kind === "block") && typeof payload.text === "string") {
                                        if (isReasoningPayload(payload, info)) {
                                            sendReasoningText(payload.text);
                                            return;
                                        }
                                        appendStockAnalysisReplyText(payload.text);
                                        if (info.kind === "final") {
                                            saveStockAnalysisReply(payload.text);
                                            sendEvent("reply", { text: extractVisibleReplyText(payload.text), isFinal: true, replace: true });
                                            return;
                                        }
                                        sendReplyText({ text: payload.text, replace: true });
                                    }
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
                        saveStockAnalysisReply(stockAnalysisReplyText);
                        await sendFinalReplyAndUsage();
                    }
                    finally {
                        delete replyTextStateMap[chatId];
                        delete reasoningLengthMap[chatId];
                        delete taggedThinkingStateMap[chatId];
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
                        const closeReason = reason.toString() || "";
                        if (closeCode === 4001 || closeCode === 4003) {
                            childLogger.error({ closeCode, reason: closeReason }, "Relay rejected credentials. Reconnect stopped.");
                            ctx.setStatus({
                                ...ctx.getStatus(),
                                running: false,
                                lastError: `Relay auth failed (${closeCode}): ${closeReason || "Forbidden"}`,
                            });
                            return;
                        }
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