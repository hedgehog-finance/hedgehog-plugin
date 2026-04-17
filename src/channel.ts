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
import { getCiweiAIRuntime } from "./runtime";
import { logger } from "./core/logger";
import type {
	CiweiAIResolvedAccount,
	RelayInboundMessage
} from "./types";
import { allFeaturesTools } from "./features";



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

		// 使用 await 异步读取，释放主线程
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
			model: entry.model,
			modelProvider: entry.modelProvider,
		};
	} catch (err) {
		return null;
	}
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
				if (entry.type === "message" && entry.message?.role === "assistant" && entry.message?.usage) {
					const u = entry.message.usage;
					return {
						input: u.input || 0,
						output: u.output || 0,
						total: u.totalTokens || 0,
						model: entry.message.model,
						provider: entry.message.provider,
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
				model: entry.model,
				provider: entry.modelProvider,
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
				model: usage.model,
				provider: usage.provider,
			};
		}
	}

	return null;
}

/**
 * Ciwei AI Channel Plugin
 */
export const ciweiAIPlugin: ChannelPlugin<CiweiAIResolvedAccount> = {
	id: "ciwei-ai",

	meta: {
		id: "ciwei-ai",
		label: "Ciwei AI",
		selectionLabel: "Ciwei AI",
		blurb: "Custom WebSocket relay channel for Ciwei AI",
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
			const channelConfig = (cfg as any)?.channels?.['ciwei-ai'];
			return channelConfig?.accountId || "default";
		},
	},

	gateway: {
		startAccount: async (ctx: ChannelGatewayContext<CiweiAIResolvedAccount>) => {
			const { account, cfg, log, abortSignal } = ctx;
			const rt = getCiweiAIRuntime();
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

			const clearStreamStates = () => {
				Object.keys(sentLengthMap).forEach(k => delete sentLengthMap[k]);
				Object.keys(reasoningLengthMap).forEach(k => delete reasoningLengthMap[k]);
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
						const tool = allFeaturesTools[method];

						if (tool && typeof tool.execute === 'function') {
							childLogger.debug({ method }, "拦截到 RPC 请求");

							try {
								// 直接使用websocket中的 accountId 作为绝对安全的 userId。
								const runContext = {
									userId: accountId
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
					}

					const { from, text, chatId, id } = appPayload;

					if (!text) return;

					const route = rt.channel.routing.resolveAgentRoute({
						cfg,
						channel: "ciwei-ai",
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
						Provider: "ciwei-ai",
						MessageSid: id,
					});

					await rt.channel.session.recordInboundSession({
						storePath,
						sessionKey: context.SessionKey || sessionKey,
						ctx: context,
						updateLastRoute: {
							sessionKey: route.mainSessionKey,
							channel: "ciwei-ai",
							to: chatId,
							accountId: String(accountId),
						},
						onRecordError: (err: unknown) => {
							childLogger.error({ err: String(err) }, "Failed to record inbound session");
						},
					});

					const startTime = Date.now();

					// Extract replyOptions to a const so TypeScript skips excess property checking.
					// This lets us include onToolResult which the SDK's Omit<> type strips,
					// but the runtime still dispatches correctly.
					const replyOpts = {
						onPartialReply: (payload: { text?: string }) => {
							if (payload.text && ws?.readyState === WebSocket.OPEN) {
								const prev = sentLengthMap[chatId] || 0;
								const delta = payload.text.slice(prev);
								sentLengthMap[chatId] = payload.text.length;
								if (delta) ws.send(JSON.stringify({
									type: "reply",
									to: from,
									chatId: chatId,
									text: delta,
									replyTo: id,
									isPartial: true,
									fromCode: code
								}));
							}
						},
						onReasoningStream: (payload: { text?: string }) => {
							if (payload.text && ws?.readyState === WebSocket.OPEN) {
								const prev = reasoningLengthMap[chatId] || 0;
								const delta = payload.text.slice(prev);
								reasoningLengthMap[chatId] = payload.text.length;
								if (delta) ws.send(JSON.stringify({
									type: "reasoning",
									to: from,
									chatId: chatId,
									text: delta,
									replyTo: id,
									fromCode: code
								}));
							}
						},
						onReasoningEnd: () => {
							if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({
								type: "reasoning_end",
								to: from,
								chatId: chatId,
								replyTo: id,
								fromCode: code
							}));
						},
						onItemEvent: (payload: { kind?: string; title?: string; name?: string; phase?: string; status?: string; summary?: string; progressText?: string }) => {
							if (payload.kind === 'tool') return;
							if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({
								type: "item_event",
								to: from,
								chatId: chatId,
								replyTo: id,
								kind: payload.kind,
								title: payload.title,
								name: payload.name,
								phase: payload.phase,
								status: payload.status,
								summary: payload.summary,
								progressText: payload.progressText,
								fromCode: code
							}));
						},
						onModelSelected: (modelCtx: { provider: string; model: string; thinkLevel: string | undefined }) => {
							if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({
								type: "model",
								to: from,
								chatId: chatId,
								replyTo: id,
								provider: modelCtx.provider,
								model: modelCtx.model,
								thinkLevel: modelCtx.thinkLevel,
								fromCode: code
							}));
						},
						onEnd: async () => {
							const durationMs = Date.now() - startTime;

							if (ws?.readyState === WebSocket.OPEN) {
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

								if (turnUsage) {
									ws.send(JSON.stringify({
										type: "usage",
										to: from,
										chatId: chatId,
										replyTo: id,
										usage: {
											input: turnUsage.input,
											output: turnUsage.output,
											total: turnUsage.total,
										},
										durationMs: durationMs,
										model: turnUsage.model,
										provider: turnUsage.provider,
										fromCode: code
									}));
								}
							}
							delete sentLengthMap[chatId];
							delete reasoningLengthMap[chatId];
						}
					};
					// 执行
					await rt.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
						cfg,
						ctx: context,
						replyOptions: replyOpts as any,
						dispatcherOptions: {
							deliver: async () => { }, // Use replyOpts for delivery
						}
					});
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
