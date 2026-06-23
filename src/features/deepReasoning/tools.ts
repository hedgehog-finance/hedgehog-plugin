import { randomUUID } from "node:crypto";
import { getDB } from "../../core/database.js";
import {
	BuildDeepReasoningMessageParams,
	BuildDeepReasoningMessageAgentToolSchema,
	BuildDeepReasoningMessageParamsSchema,
	GetDeepReasoningDetailBySessionParamsSchema,
	GetDeepReasoningDetailParamsSchema,
	QueryDeepReasoningHistoryParamsSchema,
	RuntimeTool
} from "./schema.js";

const DEEP_REASONING_SKILL = "hedgehog-in-depth-analysis";

function buildContent(args: BuildDeepReasoningMessageParams): string {
	return [
		"对这条新闻进行深度推演",
		"",
		`新闻标题：${args.sourceTitle}`,
		"",
		"新闻正文：",
		args.sourceContent
	].join("\n");
}

function buildDeepReasoningMessage(args: BuildDeepReasoningMessageParams): string {
	const sessionId = args.sessionId || "";
	return JSON.stringify({
		cw_system_prompt: [
			`第 1 步：必须触发并使用 ${DEEP_REASONING_SKILL} skill 生成新闻事件深度推演报告。`,
			`第 2 步：生成成功后必须调用 save_task_output，参数为 {"sessionId":"${sessionId}","saveStrategy":"overwrite","output":"...","status":"completed"}，output 必须原样传入 skill 生成的最终完整深度推演报告全文，禁止摘要、改写、删减、重排或重新组织。`,
			`失败处理：生成失败后必须调用 save_task_output，参数为 {"sessionId":"${sessionId}","saveStrategy":"overwrite","output":"...","status":"failed"}，output 存放完整错误信息。`
		].join("\n"),
		cw_content: buildContent(args),
		cw_output: [
			`输出结构以 ${DEEP_REASONING_SKILL} skill 的交付模板为准。`,
			'强制启用“本地缓存任务日志”'
		].join("\n")
	});
}

function mapRowToDeepReasoning(row: any) {
	const ref = JSON.parse(row.reference || "{}");
	return {
		id: row.id,
		sourceId: ref.sourceId || "",
		sourceTitle: ref.sourceTitle || "",
		market: ref.market_type || "CN",
		sessionId: row.id,
		status: row.status,
		content: row.content,
		createdAt: row.created_at,
		updatedAt: row.updated_at
	};
}

function selectGeneratingDeepReasoning(sourceId: string, market: string, sessionId?: string) {
	const db = getDB();
	const normalizedSessionId = sessionId?.trim() || "";
	if (normalizedSessionId) {
		const bySession = db.prepare(`
			SELECT id, reference, status, content, created_at, updated_at
			FROM agent_sessions
			WHERE id = ? AND biz_type = 'deep_reasoning' AND status = 'generating'
		`).get(normalizedSessionId) as any;
		if (bySession) return mapRowToDeepReasoning(bySession);
	}

	const row = db.prepare(`
		SELECT id, reference, status, content, created_at, updated_at
		FROM agent_sessions
		WHERE biz_type = 'deep_reasoning'
			AND json_extract(reference, '$.sourceId') = ?
			AND json_extract(reference, '$.market_type') = ?
			AND status = 'generating'
		ORDER BY updated_at DESC, created_at DESC
		LIMIT 1
	`).get(sourceId, market) as any;
	return row ? mapRowToDeepReasoning(row) : undefined;
}

function createGeneratingDeepReasoning(
	args: {
		sourceId: string;
		sourceTitle: string;
		market: string;
		sessionId: string;
	}
) {
	const db = getDB();
	const { sourceId, sourceTitle, market, sessionId } = args;

	const workId = `work_${sessionId}`;
	const taskId = `task_${sessionId}`;
	const refObj = {
		sourceId: sourceId,
		sourceTitle: sourceTitle.trim(),
		market_type: market
	};

	db.prepare(`
		INSERT OR IGNORE INTO works (id, name, description, status, orchestrator_type)
		VALUES (?, ?, '深度推演工作流', 'running', 'hard')
	`).run(workId, `深度推演工作流 (${sourceTitle.trim()})`);

	db.prepare(`
		INSERT OR IGNORE INTO tasks (id, work_id, name, status, agent_session_id, content)
		VALUES (?, ?, '执行深度推演', 'running', ?, '')
	`).run(taskId, workId, sessionId);

	db.prepare(`
		INSERT OR IGNORE INTO agent_sessions (id, session_name, biz_type, status, reference, content, work_id, task_id)
		VALUES (?, ?, 'deep_reasoning', 'generating', ?, '', ?, ?)
	`).run(sessionId, `深度推演 (${sourceTitle.trim()})`, JSON.stringify(refObj), workId, taskId);

	const inserted = db.prepare(`
		SELECT id, reference, status, content, created_at, updated_at
		FROM agent_sessions
		WHERE id = ?
	`).get(sessionId) as any;
	return { ...mapRowToDeepReasoning(inserted), analysisType: "deduction" };
}

export const deepReasoningTools: Record<string, RuntimeTool> = {
	query_deep_reasoning_history: {
		name: "query_deep_reasoning_history",
		label: "查询深度推演列表",
		description: "分页查询深度推演记录列表。返回记录标识、来源 ID、标题、状态和时间字段；列表结果不包含 content，详情请使用 get_deep_reasoning_detail 查询。",
		parameters: QueryDeepReasoningHistoryParamsSchema,
		registerTool: false,
		async execute(params, ctx) {
			const args = QueryDeepReasoningHistoryParamsSchema.parse(params ?? {});
			const db = getDB();
			const offset = (args.page - 1) * args.pageSize;
			const rows = db.prepare(`
				SELECT id, reference, status, created_at, updated_at
				FROM agent_sessions
				WHERE biz_type = 'deep_reasoning'
				ORDER BY updated_at DESC, created_at DESC
				LIMIT ? OFFSET ?
			`).all(args.pageSize, offset) as any[];

			const countRow = db.prepare(`
				SELECT COUNT(*) AS total FROM agent_sessions WHERE biz_type = 'deep_reasoning'
			`).get() as { total: number };
			const total = countRow.total || 0;

			const data = rows.map(r => mapRowToDeepReasoning(r));

			return JSON.stringify({
				success: true,
				data,
				pagination: {
					page: args.page,
					pageSize: args.pageSize,
					total,
					totalPages: Math.ceil(total / args.pageSize)
				}
			});
		}
	},
	get_deep_reasoning_detail: {
		name: "get_deep_reasoning_detail",
		label: "查询深度推演详情",
		description: "根据记录 ID 或 sourceId 查询深度推演完整详情，包含 content 正文及所有元数据。",
		parameters: GetDeepReasoningDetailParamsSchema,
		registerTool: false,
		async execute(params, ctx) {
			const args = GetDeepReasoningDetailParamsSchema.parse(params);
			const db = getDB();
			if (args.sourceId) {
				const row = db.prepare(`
					SELECT id, reference, status, content, created_at, updated_at
					FROM agent_sessions
					WHERE biz_type = 'deep_reasoning' AND json_extract(reference, '$.sourceId') = ?
					ORDER BY updated_at DESC, created_at DESC
					LIMIT 1
				`).get(args.sourceId);
				return JSON.stringify({ success: true, data: row ? mapRowToDeepReasoning(row) : null });
			}
			const row = db.prepare(`
				SELECT id, reference, status, content, created_at, updated_at
				FROM agent_sessions
				WHERE id = ? AND biz_type = 'deep_reasoning'
			`).get(args.id);
			return JSON.stringify({ success: true, data: row ? mapRowToDeepReasoning(row) : null });
		}
	},
	get_deep_reasoning_detail_by_session: {
		name: "get_deep_reasoning_detail_by_session",
		label: "按会话查询深度推演详情",
		description: "根据 sessionId 和 sourceId 查询深度推演详情元数据；不返回 content 正文。",
		parameters: GetDeepReasoningDetailBySessionParamsSchema,
		registerTool: false,
		async execute(params, ctx) {
			const args = GetDeepReasoningDetailBySessionParamsSchema.parse(params);
			const db = getDB();
			const row = db.prepare(`
				SELECT id, reference, status, created_at, updated_at
				FROM agent_sessions
				WHERE id = ? AND biz_type = 'deep_reasoning' AND json_extract(reference, '$.sourceId') = ?
				ORDER BY updated_at DESC, created_at DESC
				LIMIT 1
			`).get(args.sessionId, args.sourceId);
			return JSON.stringify({ success: true, data: row ? mapRowToDeepReasoning(row) : null });
		}
	},
	build_deep_reasoning_message: {
		name: "build_deep_reasoning_message",
		label: "构建深度推演消息",
		description: "发起深度推演任务，返回 Agent 消息。",
		parameters: BuildDeepReasoningMessageAgentToolSchema,
		registerTool: false,
		async execute(params) {
			const args = BuildDeepReasoningMessageParamsSchema.parse(params);
			const sessionId = args.sessionId?.trim() || randomUUID();
			const generating = selectGeneratingDeepReasoning(args.newsId, "CN", sessionId);
			if (generating) {
				return JSON.stringify({
					success: true,
					skipped: true,
					data: {
						status: (generating as { status: string }).status
					}
				});
			}
			const preflightSave = createGeneratingDeepReasoning({
				sourceId: args.newsId,
				sourceTitle: args.sourceTitle,
				market: "CN",
				sessionId: sessionId
			});
			const message = buildDeepReasoningMessage({ ...args, sessionId });
			return JSON.stringify({
				success: true,
				data: {
					status: (preflightSave as { status: string }).status,
					message
				}
			});
		}
	}
};
