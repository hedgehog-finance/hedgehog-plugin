import * as fsAsync from "node:fs/promises";
import type { PluginRuntime } from "openclaw/plugin-sdk/channel-core";
import {
	QueryChatSessionHistoryParamsSchema,
	RuntimeTool,
	SelectedInteraction,
	TranscriptEntry,
	TranscriptMessage
} from "./schema.js";
import { getDB } from "../../core/database.js";

type RuntimeSessionEntry = {
	sessionId: string;
	updatedAt: number;
	sessionFile?: string;
	status?: "running" | "done" | "failed" | "killed" | "timeout";
};

function textFromContent(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";

	return content
		.map((part) => {
			if (typeof part === "string") return part;
			if (!part || typeof part !== "object") return "";
			const record = part as Record<string, unknown>;
			if (typeof record.text === "string") return record.text;
			if (typeof record.content === "string") return record.content;
			return "";
		})
		.filter(Boolean)
		.join("");
}

function textFromRecordFields(record: Record<string, unknown>, fields: string[]): string {
	for (const field of fields) {
		const value = record[field];
		if (typeof value === "string" && value.trim()) return value;
	}
	return "";
}

function textFromThinkingContent(content: unknown): string {
	if (!Array.isArray(content)) return "";
	return content
		.map((part) => {
			if (!part || typeof part !== "object") return "";
			const record = part as Record<string, unknown>;
			const type = typeof record.type === "string" ? record.type : "";
			if (type !== "thinking" && type !== "reasoning") return "";
			return textFromRecordFields(record, ["text", "content", "reasoning", "thinking"]);
		})
		.filter(Boolean)
		.join("\n");
}

function normalizeProcessText(text: string) {
	return text.replace(/\s+/g, " ").trim();
}

function processTargetFromEntry(entry: Record<string, unknown>) {
	const params = (entry.arguments || entry.args || entry.input) as Record<string, unknown> | undefined;
	const direct = textFromRecordFields(entry, ["title", "summary", "meta", "name"]);
	if (direct) return normalizeProcessText(direct);
	if (params && typeof params === "object") {
		return normalizeProcessText(textFromRecordFields(params, ["command", "url", "href", "path", "query", "q"]));
	}
	return "";
}

function processActionFromEntry(entry: Record<string, unknown>) {
	const haystack = [entry.kind, entry.name, entry.title, entry.summary].filter(Boolean).join(" ").toLowerCase();
	const params = (entry.arguments || entry.args || entry.input) as Record<string, unknown> | undefined;
	if (/\bcurl\b|fetch url|https?:\/\/|url/.test(haystack) || typeof params?.url === "string" || typeof params?.href === "string") return "请求接口";
	if (/\bread\b|读取/.test(haystack) || typeof params?.path === "string") return "读取文件";
	if (/\bexec\b|command|shell|bash/.test(haystack) || typeof params?.command === "string") return "执行命令";
	if (/\bpatch\b|apply/.test(haystack)) return "修改文件";
	if (entry.type === "step") return "执行步骤";
	return "处理信息";
}

function processStatusFromEntry(entry: Record<string, unknown>) {
	if (entry.status === "failed" || (typeof entry.exitCode === "number" && entry.exitCode !== 0)) return "失败";
	if (entry.status === "running" || entry.phase === "start") return "进行中";
	if (entry.status === "completed" || entry.phase === "end" || entry.phase === "finish" || entry.exitCode === 0) return "完成";
	return typeof entry.status === "string" ? entry.status : "";
}

function isToolProcessEntry(entry: Record<string, unknown>) {
	const type = typeof entry.type === "string" ? entry.type : "";
	return (
		entry.kind === "tool" ||
		type === "item_event" ||
		type === "command_output" ||
		type === "patch_summary" ||
		/^tool(?:_|$)/.test(type)
	);
}

function extractThinkingText(entry: Record<string, unknown>) {
	const type = typeof entry.type === "string" ? entry.type : "";
	if (type === "reasoning") {
		return textFromRecordFields(entry, ["text", "reasoning_content", "reasoning"]);
	}

	const wrappedMessage = entry.message && typeof entry.message === "object" && !Array.isArray(entry.message)
		? entry.message as Record<string, unknown>
		: entry;
	const thinking = textFromRecordFields(wrappedMessage, ["thinking", "reasoning", "reasoning_content"]) || textFromThinkingContent(wrappedMessage.content);
	if (thinking) return thinking;

	if (!isToolProcessEntry(entry)) return "";
	if (type === "command_output" && typeof entry.output === "string" && !entry.title && !entry.summary && entry.exitCode === undefined && !entry.status) {
		return "";
	}

	const action = processActionFromEntry(entry);
	const target = processTargetFromEntry(entry);
	const status = processStatusFromEntry(entry);
	const subject = target ? `${action}：${target}` : action;
	return status ? `${subject} / ${status}` : subject;
}

function collectThinking(entries: TranscriptEntry[]) {
	const lines = entries
		.map((entry) => extractThinkingText(entry.raw).trim())
		.filter(Boolean);
	return lines.join("\n");
}

function extractTranscriptMessage(entry: unknown, includeRaw: boolean, includeEmptyAssistant: boolean): TranscriptMessage | null {
	if (!entry || typeof entry !== "object") return null;
	const record = entry as Record<string, unknown>;
	const message = record.message && typeof record.message === "object" && !Array.isArray(record.message)
		? record.message as Record<string, unknown>
		: record;

	const role = typeof message.role === "string" ? message.role : "";
	if (!role) return null;

	const text = textFromContent(message.content) || textFromContent(message.text);
	if (!includeEmptyAssistant && role === "assistant" && text.trim().length === 0) return null;
	const id = typeof record.id === "string"
		? record.id
		: typeof message.id === "string"
			? message.id
			: `${role}_${typeof record.timestamp === "number" ? record.timestamp : Date.now()}`;

	return {
		id,
		role,
		text,
		timestamp: typeof record.timestamp === "number" || typeof record.timestamp === "string"
			? record.timestamp
			: typeof message.timestamp === "number" || typeof message.timestamp === "string"
				? message.timestamp
				: undefined,
		...(includeRaw ? { raw: message } : {})
	};
}

function isTurnCompleteEntry(entry: Record<string, unknown>, interactionId?: string) {
	const type = typeof entry.type === "string" ? entry.type : "";
	const event = typeof entry.event === "string" ? entry.event : "";
	const replyTo = typeof entry.replyTo === "string" ? entry.replyTo : typeof entry.reply_to === "string" ? entry.reply_to : "";
	const idMatches = !interactionId || replyTo === interactionId || entry.interactionId === interactionId || entry.turnId === interactionId;

	if (!idMatches) return false;
	if (type === "turn_complete" || event === "turn_complete") return true;
	if (type === "reply" && entry.isFinal === true && typeof entry.text !== "string" && typeof entry.content !== "string" && typeof entry.reply !== "string") return true;
	return false;
}

async function readTranscriptEntries(params: {
	filePath: string;
	includeTools: boolean;
	includeRaw: boolean;
	includeEmptyAssistant: boolean;
}): Promise<TranscriptEntry[]> {
	let content = "";
	try {
		content = await fsAsync.readFile(params.filePath, "utf-8");
	} catch {
		return [];
	}
	const lines = content.split("\n").filter(Boolean);
	const entries: TranscriptEntry[] = [];

	for (const line of lines) {
		try {
			const entry = JSON.parse(line) as unknown;
			const message = extractTranscriptMessage(entry, params.includeRaw, params.includeEmptyAssistant);
			const raw = entry && typeof entry === "object" && !Array.isArray(entry) ? entry as Record<string, unknown> : {};
			if (message && (params.includeTools || message.role === "user" || message.role === "assistant")) {
				entries.push({ message, raw });
			} else {
				entries.push({ message: null, raw });
			}
		} catch {
			continue;
		}
	}

	return entries;
}

function selectInteraction(entries: TranscriptEntry[], limit: number, interactionId?: string): SelectedInteraction {
	const messages = entries.flatMap((entry) => entry.message ? [entry.message] : []);
	if (messages.length === 0) {
		return {
			messages: [],
			turnComplete: false,
			turnCompleteSource: "none",
			lastUserMessageId: null,
			lastAssistantMessageId: null,
		};
	}

	let startIndex = -1;
	let startEntryIndex = -1;
	if (interactionId) {
		startIndex = messages.findIndex((message) => message.role === "user" && message.id === interactionId);
		startEntryIndex = entries.findIndex((entry) => entry.message?.role === "user" && entry.message.id === interactionId);
	}

	if (startIndex < 0) {
		for (let index = messages.length - 1; index >= 0; index--) {
			if (messages[index].role === "user") {
				startIndex = index;
				break;
			}
		}
	}
	if (startEntryIndex < 0) {
		for (let index = entries.length - 1; index >= 0; index--) {
			if (entries[index].message?.role === "user") {
				startEntryIndex = index;
				break;
			}
		}
	}

	const interaction = startIndex >= 0 ? messages.slice(startIndex) : messages.slice(-1);
	const interactionEntries = startEntryIndex >= 0 ? entries.slice(startEntryIndex) : entries.slice(-1);
	const lastUserMessage = [...interaction].reverse().find((message) => message.role === "user");
	const lastAssistantMessage = [...interaction].reverse().find((message) => (
		message.role === "assistant" && message.text.trim().length > 0
	));
	const hasLifecycleComplete = entries.some((entry) => isTurnCompleteEntry(entry.raw, interactionId || lastUserMessage?.id));
	const thinking = collectThinking(interactionEntries);
	const messagesWithThinking = thinking && lastAssistantMessage
		? interaction.map((message) => message.id === lastAssistantMessage.id ? { ...message, thinking } : message)
		: interaction;

	return {
		messages: messagesWithThinking.slice(-limit),
		turnComplete: hasLifecycleComplete || Boolean(lastUserMessage && lastAssistantMessage),
		turnCompleteSource: hasLifecycleComplete ? "lifecycle" : lastUserMessage && lastAssistantMessage ? "messages" : "none",
		lastUserMessageId: lastUserMessage?.id || null,
		lastAssistantMessageId: lastAssistantMessage?.id || null,
	};
}

function agentIdFromSessionKey(sessionKey: string): string | null {
	const match = /^agent:([^:]+):/.exec(sessionKey);
	return match?.[1] || null;
}

function resolveDailyMorningBriefingSession(rt: PluginRuntime, dailyMorningBriefingId: string, requestedAgentId?: string) {
	try {
		const db = getDB();
		const row = db.prepare(`
			SELECT sessionId
			FROM daily_morning_briefings
			WHERE id = ?
			ORDER BY updatedAt DESC
			LIMIT 1
		`).get(dailyMorningBriefingId) as { sessionId: string } | undefined;
		if (!row?.sessionId) return null;

		const cfg = rt.config.loadConfig();
		const sessionKey = row.sessionId;
		const agentId = requestedAgentId || agentIdFromSessionKey(sessionKey) || "hedgehog-finance";
		const storePath = rt.agent.session.resolveStorePath(cfg.session?.store, { agentId });
		const store = rt.agent.session.loadSessionStore(storePath);
		const sessionKeyCandidates = Array.from(new Set([
			sessionKey,
			sessionKey.replace(":CN:", ":cn:"),
			sessionKey.replace(":cn:", ":CN:")
		]));
		const matchedSessionKey = sessionKeyCandidates.find(candidate => store[candidate]);
		const entry = matchedSessionKey ? store[matchedSessionKey] as RuntimeSessionEntry | undefined : undefined;
		if (!entry) return null;
		return {
			agentId,
			sessionKey: matchedSessionKey || sessionKey,
			entry,
			matchedBy: "dailyMorningBriefing" as const
		};
	} catch {
		return null;
	}
}

function resolveChatSession(rt: PluginRuntime, accountId: string, sessionId: string, requestedAgentId?: string) {
	const cfg = rt.config.loadConfig();
	const chatId = sessionId;
	const route = rt.channel.routing.resolveAgentRoute({
		cfg,
		channel: "hedgehog_finance",
		accountId,
		peer: { kind: "direct", id: chatId },
	});

	let agentId = requestedAgentId || route.agentId;
	let sessionKey = route.sessionKey;

	if (requestedAgentId || chatId.startsWith("main")) {
		agentId = requestedAgentId || "main";
		sessionKey = rt.channel.routing.buildAgentSessionKey({
			agentId,
			channel: "hedgehog_finance",
			accountId,
			peer: { kind: "direct", id: chatId },
		});
	}

	const storePath = rt.agent.session.resolveStorePath(cfg.session?.store, { agentId });
	const store = rt.agent.session.loadSessionStore(storePath);
	let entry = store[sessionKey] as RuntimeSessionEntry | undefined;
	if (entry) return { agentId, sessionKey, entry, matchedBy: "chatId" as const };

	const matched = Object.entries(store)
		.find((item): item is [string, RuntimeSessionEntry] => {
			const candidate = item[1] as Partial<RuntimeSessionEntry>;
			return candidate.sessionId === sessionId;
		});
	if (matched) {
		return {
			cfg,
			agentId,
			sessionKey: matched[0],
			entry: matched[1],
			matchedBy: "openclawSessionId" as const
		};
	}

	return { agentId, sessionKey, entry: null, matchedBy: "none" as const };
}

export const chatSessionHistoryTools: Record<string, RuntimeTool> = {
	query_chat_session_history: {
		name: "query_chat_session_history",
		description: "查询 OpenClaw 会话 transcript。普通聊天通过 sessionId/chatId 解析 channel sessionKey；每日盘前早报通过 dailyMorningBriefingId 读取业务记录中的实际 sessionKey，并兼容早报 market 片段大小写差异。",
		parameters: QueryChatSessionHistoryParamsSchema,
		registerTool: false,
		async execute(params, ctx) {
			const args = QueryChatSessionHistoryParamsSchema.parse(params);
			const rt = ctx?.runtime;
			const accountId = ctx?.userId;
			if (!rt || !accountId) {
				return JSON.stringify({ success: false, error: "runtime or userId unavailable" });
			}

			const requestedSessionId = args.sessionId || args.dailyMorningBriefingId || "";
			let resolved;
			if (args.sessionId) {
				resolved = resolveChatSession(rt, String(accountId), args.sessionId, args.agentId);
			} else {
				const dailyMorningBriefingId = args.dailyMorningBriefingId || "";
				resolved = resolveDailyMorningBriefingSession(rt, dailyMorningBriefingId, args.agentId) || {
					agentId: args.agentId || "hedgehog-finance",
					sessionKey: dailyMorningBriefingId,
					entry: null,
					matchedBy: "none" as const
				};
			}
			if (!resolved.entry) {
				return JSON.stringify({
					success: true,
					data: {
						sessionId: requestedSessionId,
						agentId: resolved.agentId,
						sessionKey: resolved.sessionKey,
						openclawSessionId: null,
						matchedBy: resolved.matchedBy,
						interactionId: args.interactionId || null,
						turnComplete: false,
						turnCompleteSource: "none",
						lastUserMessageId: null,
						lastAssistantMessageId: null,
						messages: []
					}
				});
			}

			const filePath = rt.agent.session.resolveSessionFilePath(
				resolved.entry.sessionId,
				resolved.entry,
				{ agentId: resolved.agentId }
			);
			const entries = await readTranscriptEntries({
				filePath,
				includeTools: args.includeTools,
				includeRaw: args.includeRaw,
				includeEmptyAssistant: args.includeEmptyAssistant
			});
			const selectedInteraction = selectInteraction(entries, args.limit, args.interactionId);

			return JSON.stringify({
				success: true,
				data: {
					sessionId: requestedSessionId,
					agentId: resolved.agentId,
					sessionKey: resolved.sessionKey,
					openclawSessionId: resolved.entry.sessionId,
					matchedBy: resolved.matchedBy,
					interactionId: args.interactionId || null,
					turnComplete: selectedInteraction.turnComplete,
					turnCompleteSource: selectedInteraction.turnCompleteSource,
					lastUserMessageId: selectedInteraction.lastUserMessageId,
					lastAssistantMessageId: selectedInteraction.lastAssistantMessageId,
					messages: selectedInteraction.messages
				}
			});
		}
	}
};
