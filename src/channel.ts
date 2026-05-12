import * as os from "node:os";
import * as fs from "node:fs";
import * as fsAsync from "node:fs/promises";
import * as path from "node:path";
import { WebSocket, RawData } from "ws";
import { emptyChannelConfigSchema } from "openclaw/plugin-sdk/core";
import type { ChannelPlugin } from "openclaw/plugin-sdk/channel-plugin-common";
import type { OpenClawConfig } from "openclaw/plugin-sdk/config-runtime";
import type {
	ChannelGatewayContext,
	ChannelAccountSnapshot,
	ChannelStatusIssue
} from "openclaw/plugin-sdk/channel-contract";
import { getHedgehogRuntime } from "./runtime.js";
import { logger } from "./core/logger.js";
import type {
	HedgehogFinanceResolvedAccount,
	RelayInboundMessage
} from "./types.js";
import { allFeaturesTools } from "./features/index.js";



/**
 * Unix timestamp
 */
function getCurrentTimestamp(): number {
	return Date.now();
}

/**
 * 获取 OpenClaw state 目录
 */
function getStateDir(): string {
	return process.env.OPENCLAW_STATE_DIR ||
		process.env.CLAWD_STATE_DIR ||
		path.join(os.homedir(), ".openclaw");
}

/**
 * [修改] 异步从 sessions.json 获取 session entry
 */
async function getSessionEntryAsync(agentId: string, sessionKey: string) {
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
	} catch (err) {
		return null;
	}
}

function toFiniteNumber(...values: unknown[]): number | undefined {
	for (const value of values) {
		if (value === undefined || value === null || value === "") continue;
		const num = Number(value);
		if (Number.isFinite(num)) return num;
	}
	return undefined;
}

function normalizeUsageSnapshot(usageRaw: any) {
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

/**
 * [修改] 异步获取 .jsonl 文件的当前行数
 */
async function getJsonlLineCountAsync(agentId: string, sessionId: string): Promise<number> {
	try {
		const stateDir = getStateDir();
		const jsonlPath = path.join(stateDir, "agents", agentId, "sessions", `${sessionId}.jsonl`);

		if (!fs.existsSync(jsonlPath)) {
			return 0;
		}

		const content = await fsAsync.readFile(jsonlPath, "utf-8");
		return content.trim().split("\n").filter(Boolean).length;
	} catch {
		return 0;
	}
}

/**
 * [修改] 异步从 .jsonl session 文件读取指定行号之后的第一条 assistant 消息的 usage
 */
async function readUsageFromJsonlAsync(agentId: string, sessionId: string, afterLine: number) {
	try {
		const stateDir = getStateDir();
		const jsonlPath = path.join(stateDir, "agents", agentId, "sessions", `${sessionId}.jsonl`);

		if (!fs.existsSync(jsonlPath)) {
			return null;
		}

		const content = await fsAsync.readFile(jsonlPath, "utf-8");
		const lines = content.trim().split("\n").filter(Boolean);

		// 从 afterLine 开始向后找第一条 assistant 消息
		for (let i = afterLine; i < lines.length; i++) {
			try {
				const entry = JSON.parse(lines[i]);
				const message = entry.message && typeof entry.message === "object" && !Array.isArray(entry.message) ? entry.message : undefined;
				if (message?.role && message.role !== "assistant") continue;
				const usage = normalizeUsageSnapshot(message?.usage || entry.usage);
				if (usage) {
					return {
						...usage,
						model: message?.model || entry.model,
						provider: message?.provider || entry.provider,
					};
				}
			} catch {
				continue;
			}
		}
		return null;
	} catch {
		return null;
	}
}


/**
 * [修改] 异步获取本轮对话的 token 用量
 */
async function getCurrentTurnUsageAsync(
	agentId: string,
	sessionKey: string,
	sessionIdBefore: string | null,
	lineCountBefore: number,
	maxRetries: number = 60,
	retryDelayMs: number = 100
) {
	// 第一阶段：尝试从 sessions.json 读取
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

	// 第二阶段：Fallback 到 .jsonl 文件
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

/**
 * Hedgehog Finance Channel Plugin
 */
export const hedgehogFinancePlugin: ChannelPlugin<HedgehogFinanceResolvedAccount> = {
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
		listAccountIds: (cfg: OpenClawConfig): string[] => {
			const channelConfig = (cfg.channels?.['hedgehog_finance'] || {}) as any;

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

		resolveAccount: (cfg: OpenClawConfig, accountId?: string | null): HedgehogFinanceResolvedAccount => {
			const channelConfig = (cfg.channels?.['hedgehog_finance'] || {}) as any;
			const id = accountId || channelConfig.accountId || "default";

			let accountInfo: any;
			if (channelConfig.accounts) {
				if (Array.isArray(channelConfig.accounts)) {
					accountInfo = channelConfig.accounts.find((a: any) => (a.accountId || a.id) === id);
				} else {
					accountInfo = channelConfig.accounts[id];
				}
			}

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
					token: finalConfig.token || "",
					code: finalConfig.code || `OpenClaw-${os.hostname()}`,
				},
				enabled: accountInfo?.enabled !== false,
				configured: Boolean(finalConfig.token),
			};
		},

		defaultAccountId: (cfg: OpenClawConfig): string => {
			const channelConfig = (cfg as any)?.channels?.['hedgehog_finance'];
			return channelConfig?.accountId || "default";
		},
	},

	gateway: {
		startAccount: async (ctx: ChannelGatewayContext<HedgehogFinanceResolvedAccount>) => {
			const { account, cfg, log, abortSignal } = ctx;
			const rt = getHedgehogRuntime();
			const accountId = String(account.accountId);
			const childLogger = logger.child({ accountId });
			const token = account.config.token || "";
			const code = account.config.code || `OpenClaw-${os.hostname()}`;
			const relayUrl = `wss://relay.ciweiai.com/relay?id=${accountId}&token=${token}&role=provider&code=${code}`;

			let ws: WebSocket | null = null;
			let isClosing = false;
			let heartbeatInterval: NodeJS.Timeout | null = null;

			// [状态管理分离]
			const sentLengthMap: Record<string, number> = {};
			const reasoningLengthMap: Record<string, number> = {};
			const commandOutputMap = new Map<string, string>(); // [新增] 命令输出缓存: itemId -> fullOutput

			const clearStreamStates = () => {
				Object.keys(sentLengthMap).forEach(k => delete sentLengthMap[k]);
				Object.keys(reasoningLengthMap).forEach(k => delete reasoningLengthMap[k]);
				commandOutputMap.clear();
			};

			let resolveStop: (value: void | PromiseLike<void>) => void;
			const stopPromise = new Promise<void>((resolve) => {
				resolveStop = resolve;
			});

			const stopClient = () => {
				if (isClosing) return;
				isClosing = true;

				if (heartbeatInterval) clearInterval(heartbeatInterval);
				clearStreamStates(); // [生命周期管理]：清理内存状态

				childLogger.info("Stopping gateway...");

				try {
					ws?.close();
				} catch (err: any) {
					childLogger.warn({ err: err.message }, "Error during close");
				}

				ctx.setStatus({
					...ctx.getStatus(),
					running: false,
					lastStopAt: getCurrentTimestamp(),
				});

				resolveStop();
			};

			// [事件处理分离]：抽离出独立的 async 消息处理器

			// channel.ts 中的 handleInboundMessage
			const handleInboundMessage = async (data: RawData) => {
				ctx.setStatus({
					...ctx.getStatus(),
					lastEventAt: getCurrentTimestamp(),
				});

				try {
					const appPayload: RelayInboundMessage = JSON.parse(data.toString());
					// ==========================================
					// 【新增】手动识别并拦截 RPC 请求 (type: "req")
					// ==========================================
					if (appPayload.type === "req") {
						const { id, method, params } = appPayload;

						if (!method) return;

						// 从中央工具注册表中查找方法
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
								// 直接使用websocket中的 accountId 作为绝对安全的 userId。
								const runContext = {
									userId: accountId,
									runtime: rt
								};

								// 执行业务逻辑：传入业务参数 (params) 和安全上下文 (runContext)
								const resultStr = await tool.execute(params, runContext);
								const resultObj = JSON.parse(resultStr);

								// 按照 OpenClaw 官方 res 协议手动回包（成功状态）
								if (ws?.readyState === WebSocket.OPEN) {
									ws.send(JSON.stringify({
										type: "res",
										id: id,
										ok: true,
										payload: resultObj
									}));
								}
							} catch (err: any) {
								childLogger.error({ err: err.message, method }, "RPC 执行失败");

								// 按照 OpenClaw 官方 res 协议手动回包（失败状态）
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

					if (!text) return;

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
						AgentWorkspace: (route as any).agentWorkspace,
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
						onRecordError: (err: unknown) => {
							childLogger.error({ err: String(err) }, "Failed to record inbound session");
						},
					});

					const startTime = Date.now();

					const sendEvent = (type: string, data: any = {}) => {
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


					const normalizeId = (rawId?: string) => rawId?.replace(/^(command:|tool:|call_)/, '');
					let hasSentModelEvent = false;

					const sendModelEvent = (payload: { provider?: string; model?: string; thinkLevel?: string }) => {
						if (!payload.provider && !payload.model) return;
						if (hasSentModelEvent) return;
						hasSentModelEvent = true;
						sendEvent("model", payload);
					};

					const sendFinalReplyAndUsage = async () => {
						const durationMs = Date.now() - startTime;

						if (ws?.readyState !== WebSocket.OPEN) return;

						ws.send(JSON.stringify({
							type: "reply",
							to: from,
							chatId: chatId,
							replyTo: id,
							isFinal: true,
							fromCode: code
						}));

						const turnUsage = await getCurrentTurnUsageAsync(
							agentId,
							sessionKey,
							sessionIdBefore,
							lineCountBefore
						);

						if (ws?.readyState !== WebSocket.OPEN) return;
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
						verboseLevel: 'full',
						shouldEmitToolResult: true,
						shouldEmitToolOutput: true,
						onPartialReply: (payload: { text?: string }) => {
							if (payload.text) {
								const prev = sentLengthMap[chatId] || 0;
								const delta = payload.text.slice(prev);
								sentLengthMap[chatId] = payload.text.length;
								if (delta) sendEvent("reply", { text: delta, isPartial: true });
							}
						},
						onReasoningStream: (payload: { text?: string }) => {
							if (payload.text) {
								const prev = reasoningLengthMap[chatId] || 0;
								const delta = payload.text.slice(prev);
								reasoningLengthMap[chatId] = payload.text.length;
								if (delta) sendEvent("reasoning", { text: delta });
							}
						},
						onReasoningEnd: () => sendEvent("reasoning_end"),
						onAssistantMessageStart: () => {
							sentLengthMap[chatId] = 0;
							reasoningLengthMap[chatId] = 0;
							sendEvent("assistant_message_start");
						},
						onModelSelected: (payload: { provider?: string; model?: string; thinkLevel?: string }) => {
							sendModelEvent(payload);
						},
						onItemEvent: (payload: { itemId?: string; toolCallId?: string; kind?: string; title?: string; name?: string; status?: string; summary?: string }) => {
							const rawId = payload.itemId || payload.toolCallId || `temp_${payload.kind || 'item'}_${payload.title || payload.name || 'unnamed'}`;
							const itemId = normalizeId(rawId);
							sendEvent("item_event", { ...payload, itemId, toolCallId: itemId });
						},
						onCommandOutput: (payload: { itemId?: string; toolCallId?: string; phase?: string; output?: string; exitCode?: number | null; status?: string }) => {
							const itemId = normalizeId(payload.itemId || payload.toolCallId || 'global')!;
							const last = commandOutputMap.get(itemId) || "";
							const full = payload.phase === 'delta' ? (last + (payload.output || "")) : (payload.output || "");
							commandOutputMap.set(itemId, full);
							if (payload.output || payload.exitCode !== undefined || payload.status === 'completed') {
								sendEvent("command_output", { ...payload, output: full, itemId });
							}
						}
					};
					// 1. 显式类型化的配置 (保证观测开启)
					const finalCfg: OpenClawConfig = {
						...cfg,
						agents: {
							...cfg.agents,
							defaults: {
								...(cfg.agents?.defaults || {}),
								verboseDefault: 'full'
							}
						}
					};

					// 2. 类型推导 (保证不瞎搞类型)
					type DispatchParams = Parameters<typeof rt.channel.reply.dispatchReplyWithBufferedBlockDispatcher>[0];
					type RawReplyOptions = NonNullable<DispatchParams["replyOptions"]>;

					// 3. 准备回复选项
					const finalReplyOpts = { ...replyOpts } as RawReplyOptions;

					try {
						// 4. 执行稳定分发
						await rt.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
							cfg: finalCfg,
							ctx: context,
							replyOptions: finalReplyOpts,
							dispatcherOptions: {
								deliver: async (payload, info) => {
									// 原有的兜底逻辑保持不变
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
					} finally {
						delete sentLengthMap[chatId];
						delete reasoningLengthMap[chatId];
					}
				} catch (err: any) {
					childLogger.error({ err: err.message }, "Dispatch error");
				}
			};

			const connect = () => {
				if (isClosing) return;

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

					if (heartbeatInterval) clearInterval(heartbeatInterval);
					heartbeatInterval = setInterval(() => {
						if (ws?.readyState === WebSocket.OPEN) {
							ws.ping();
						}
					}, 30000);
				});

				// 绑定消息处理
				ws.on("message", handleInboundMessage);

				ws.on("error", (err) => {
					childLogger.error({ err: err.message }, "WebSocket error");
					ctx.setStatus({
						...ctx.getStatus(),
						lastError: `Connection error: ${err.message}`,
					});
				});

				ws.on("close", (closeCode, reason) => {
					if (heartbeatInterval) clearInterval(heartbeatInterval);
					clearStreamStates(); // [生命周期管理]：断开时清理状态

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
		collectStatusIssues: (accounts: ChannelAccountSnapshot[]): ChannelStatusIssue[] => {
			return accounts.flatMap((account) => {
				if (!account.configured) {
					return [
						{
							channel: "hedgehog_finance",
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
		probeAccount: async ({ account }: { account: HedgehogFinanceResolvedAccount }) => {
			if (!account.configured || !account.config?.token) {
				return { ok: false, error: "Token not configured" };
			}
			return { ok: true, details: { relay: "wss://relay.ciweiai.com/relay" } };
		},
		buildAccountSnapshot: ({ account, runtime, snapshot, probe }: {
			account: HedgehogFinanceResolvedAccount,
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
