import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { logger } from "./core/logger.js";
import { CHART_OUTPUT_GUIDANCE } from "./features/chartOutput.js";
import { HEDGEHOG_AGENT_ID } from "./openclawConstants.js";

const DAILY_MORNING_BRIEFING_CRON_ID = "hedgehog_daily_morning_briefing";
const DAILY_MORNING_BRIEFING_SESSION_KEY = `cron:${DAILY_MORNING_BRIEFING_CRON_ID}`;
const DAILY_MORNING_BRIEFING_SKILL = "hedgehog-daily-morning-briefing";
const DAILY_MORNING_BRIEFING_MESSAGE = JSON.stringify({
	cw_system_prompt: [
		"必须先调用 dispatch_daily_morning_briefing，参数为 {}。",
		"dispatch_daily_morning_briefing 会负责判断 7:30 前跳过、当天已完成跳过、当天生成中则调度当天生成会话继续、当天未触发则启动当天生成会话。",
		"调用 dispatch_daily_morning_briefing 后必须立即停止，不要直接调用 save_daily_morning_briefing、不要直接触发 skill、不要自行生成早报正文。",
		`真正的每日早报生成会在按日期隔离的会话中触发并使用 ${DAILY_MORNING_BRIEFING_SKILL} skill 完成。`
	].join("\n"),
	cw_market: "CN",
	cw_content: [
		"生成每日早报"
	].join("\n"),
	cw_output: [
		`输出结构以 ${DAILY_MORNING_BRIEFING_SKILL} skill 的交付模板为准。`,
		'强制启用“本地缓存任务日志”',
		CHART_OUTPUT_GUIDANCE
	].join("\n")
});

type CronServiceLike = {
	list(opts?: { includeDisabled?: boolean }): Promise<CronJobLike[]>;
	add(input: DailyMorningBriefingCronConfig | DailyMorningBriefingTurnCronConfig): Promise<unknown>;
	update(id: string, patch: DailyMorningBriefingCronConfig): Promise<unknown>;
	remove(id: string): Promise<{ ok?: boolean; removed?: boolean } | undefined>;
};

type CronJobLike = {
	id?: string;
	agentId?: string;
	sessionKey?: string;
	name?: string;
	description?: string;
	enabled?: boolean;
	deleteAfterRun?: boolean;
	sessionTarget?: string;
	wakeMode?: string;
	payload?: {
		kind?: string;
		message?: string;
		timeoutSeconds?: number;
	};
	delivery?: {
		mode?: string;
	};
	failureAlert?: false;
	schedule?: {
		kind?: string;
		expr?: string;
		at?: string;
		tz?: unknown;
	};
};

type DailyMorningBriefingCronConfig = {
	agentId: string;
	name: string;
	description: string;
	enabled: boolean;
	schedule: {
		kind: "cron";
		expr: string;
		tz?: string;
	};
	sessionTarget: "isolated";
	wakeMode: "now";
	payload: {
		kind: "agentTurn";
		message: string;
		timeoutSeconds: number;
	};
	delivery: {
		mode: "none";
	};
	failureAlert: false;
	deleteAfterRun: false;
};

type DailyMorningBriefingTurnCronConfig = {
	agentId: string;
	sessionKey: string;
	name: string;
	description: string;
	enabled: boolean;
	deleteAfterRun: true;
	schedule: {
		kind: "at";
		at: string;
	};
	sessionTarget: `session:${string}`;
	wakeMode: "now";
	payload: {
		kind: "agentTurn";
		message: string;
		timeoutSeconds: number;
	};
	delivery: {
		mode: "none";
	};
	failureAlert: false;
};

type ComparableDailyMorningBriefingCronConfig = {
	agentId?: string;
	name?: string;
	description?: string;
	enabled?: boolean;
	schedule: {
		kind?: string;
		expr?: string;
		tz?: unknown;
	};
	sessionTarget?: string;
	wakeMode?: string;
	payload: {
		kind?: string;
		message?: string;
		timeoutSeconds?: number;
	};
	delivery: {
		mode?: string;
	};
	failureAlert?: false;
	deleteAfterRun?: boolean;
};

let dailyMorningBriefingCronService: CronServiceLike | undefined;

function buildDailyMorningBriefingCronConfig(existing?: CronJobLike): DailyMorningBriefingCronConfig {
	const existingTz = typeof existing?.schedule?.tz === "string" && existing.schedule.tz.trim()
		? existing.schedule.tz
		: undefined;

	return {
		agentId: HEDGEHOG_AGENT_ID,
		name: DAILY_MORNING_BRIEFING_CRON_ID,
		description: "触发 hedgehog-daily-morning-briefing skill 生成每日盘前早报并入库。",
		enabled: true,
		schedule: {
			kind: "cron",
			expr: "*/30 7-23 * * *",
			...(existingTz ? { tz: existingTz } : {})
		},
		sessionTarget: "isolated",
		wakeMode: "now",
		payload: {
			kind: "agentTurn",
			message: DAILY_MORNING_BRIEFING_MESSAGE,
			timeoutSeconds: 0
		},
		delivery: {
			mode: "none"
		},
		failureAlert: false,
		deleteAfterRun: false
	};
}

function isDailyMorningBriefingCronJob(job: CronJobLike): boolean {
	return job?.name === DAILY_MORNING_BRIEFING_CRON_ID || job?.sessionKey === DAILY_MORNING_BRIEFING_SESSION_KEY;
}

function normalizeDailyMorningBriefingCronConfig(input: CronJobLike | DailyMorningBriefingCronConfig): ComparableDailyMorningBriefingCronConfig {
	const tz = typeof input.schedule?.tz === "string" && input.schedule.tz.trim()
		? input.schedule.tz
		: undefined;

	return {
		agentId: input.agentId,
		name: input.name,
		description: input.description,
		enabled: input.enabled,
		schedule: {
			kind: input.schedule?.kind,
			expr: input.schedule?.expr,
			...(tz ? { tz } : {})
		},
		sessionTarget: input.sessionTarget,
		wakeMode: input.wakeMode,
		payload: {
			kind: input.payload?.kind,
			message: input.payload?.message,
			timeoutSeconds: input.payload?.timeoutSeconds
		},
		delivery: {
			mode: input.delivery?.mode
		},
		failureAlert: input.failureAlert,
		deleteAfterRun: input.deleteAfterRun
	};
}

function buildDailyMorningBriefingTurnCronName(action: "start" | "continue", idempotencyKey: string): string {
	return `daily-morning-briefing-${action}-${idempotencyKey.replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 96)}`;
}

async function removeExistingDailyMorningBriefingTurnCron(cron: CronServiceLike, name: string): Promise<void> {
	const existingJobs = (await cron.list({ includeDisabled: true }))
		.filter(job => job.name === name)
		.map(job => job.id)
		.filter((id): id is string => typeof id === "string" && id.length > 0);
	await Promise.all(existingJobs.map(id => cron.remove(id)));
}

function isDailyMorningBriefingCronConfigCurrent(job: CronJobLike, config: DailyMorningBriefingCronConfig): boolean {
	return JSON.stringify(normalizeDailyMorningBriefingCronConfig(job))
		=== JSON.stringify(normalizeDailyMorningBriefingCronConfig(config));
}

export async function ensureDailyMorningBriefingCron(cron: CronServiceLike | undefined): Promise<void> {
	try {
		if (!cron) {
			logger.warn("Daily morning briefing cron was not scheduled because OpenClaw cron API is unavailable");
			return;
		}
		dailyMorningBriefingCronService = cron;

		const existingJobs = (await cron.list({ includeDisabled: true })).filter(isDailyMorningBriefingCronJob);
		const [primaryJob, ...duplicateJobs] = existingJobs;

		if (primaryJob?.id) {
			const config = buildDailyMorningBriefingCronConfig(primaryJob);
			if (!isDailyMorningBriefingCronConfigCurrent(primaryJob, config)) {
				await cron.update(primaryJob.id, config);
			}
		} else {
			await cron.add(buildDailyMorningBriefingCronConfig());
		}

		const duplicateIds = duplicateJobs
			.map(job => job.id)
			.filter((id): id is string => typeof id === "string" && id.length > 0);
		await Promise.all(duplicateIds.map(id => cron.remove(id)));
	} catch (e) {
		logger.error({ err: e }, "Failed to ensure daily morning briefing cron");
	}
}

export function registerDailyMorningBriefingCron(api: OpenClawPluginApi): void {
	api.on("gateway_start", async (_event, ctx) => {
		await ensureDailyMorningBriefingCron(ctx.getCron?.() as unknown as CronServiceLike | undefined);
	});
}

export async function scheduleDailyMorningBriefingTurnCron(params: {
	action: "start" | "continue";
	sessionKey: string;
	message: string;
	idempotencyKey: string;
}): Promise<void> {
	const cron = dailyMorningBriefingCronService;
	if (!cron) throw new Error("daily morning briefing cron service is unavailable");

	const name = buildDailyMorningBriefingTurnCronName(params.action, params.idempotencyKey);
	await removeExistingDailyMorningBriefingTurnCron(cron, name);
	await cron.add({
		agentId: HEDGEHOG_AGENT_ID,
		sessionKey: params.sessionKey,
		name,
		description: "触发每日盘前早报生成会话。",
		enabled: true,
		deleteAfterRun: true,
		schedule: {
			kind: "at",
			at: new Date(Date.now() + 1000).toISOString()
		},
		sessionTarget: `session:${params.sessionKey}`,
		wakeMode: "now",
		payload: {
			kind: "agentTurn",
			message: params.message,
			timeoutSeconds: 0
		},
		delivery: {
			mode: "none"
		},
		failureAlert: false
	});
}
