export interface SaveTasksOutputParams {
	sessionId: string;
	saveStrategy: "update" | "overwrite";
	output: string;
	status?: "pending" | "running" | "paused" | "completed" | "failed" | "cancelled" | "skipped" | "generating";
}

export interface QueryTasksOutputParams {
	taskId?: string;
	workflowId?: string;
	sessionId?: string;
	page: number;
	pageSize: number;
}

export interface GetTasksOutputParams {
	sessionId: string;
}

export const SaveTasksOutputParamsSchema = {
	type: "object",
	additionalProperties: false,
	required: ["sessionId", "saveStrategy", "output"],
	properties: {
		sessionId: { type: "string", minLength: 1, description: "会话 ID" },
		saveStrategy: { type: "string", enum: ["update", "overwrite"], description: "保存策略：update 追加到已有输出；overwrite 新增或覆盖整个输出" },
		output: { type: "string", description: "本次会话任务输出内容" },
		status: { type: "string", enum: ["pending", "running", "paused", "completed", "failed", "cancelled", "skipped", "generating"], description: "任务状态" }
	}
};

export const GetTasksOutputParamsSchema = {
	type: "object",
	additionalProperties: false,
	required: ["sessionId"],
	properties: {
		sessionId: { type: "string", minLength: 1, description: "会话 ID" }
	}
};

export const QueryTasksOutputParamsSchema = {
	type: "object",
	additionalProperties: false,
	properties: {
		taskId: { type: "string", minLength: 1, description: "任务 ID" },
		workflowId: { type: "string", minLength: 1, description: "工作流 ID" },
		sessionId: { type: "string", minLength: 1, description: "会话 ID" },
		page: { type: "integer", minimum: 1, default: 1, description: "页码" },
		pageSize: { type: "integer", minimum: 1, maximum: 100, default: 20, description: "每页数量，默认 20" }
	}
};

export interface TasksOutput {
	taskId: string;
	workflowId: string;
	sessionId: string;
	output: string;
	createdAt: string;
	updatedAt: string;
}

export interface RuntimeTool {
	name: string;
	label?: string;
	description: string;
	parameters: unknown;
	registerTool?: boolean;
	execute(params: unknown, ctx?: { userId?: string }): Promise<string>;
}
