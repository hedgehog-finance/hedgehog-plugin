import { logger } from "./core/logger.js";
import { HEDGEHOG_AGENT_ID } from "./openclawConstants.js";
const DAILY_MORNING_BRIEFING_CRON_ID = "hedgehog_daily_morning_briefing";
const DAILY_MORNING_BRIEFING_SESSION_KEY = `cron:${DAILY_MORNING_BRIEFING_CRON_ID}`;
const DAILY_MORNING_BRIEFING_MESSAGE = JSON.stringify({
    cw_system_prompt: [
        "第 1 步：必须调用 dispatch_daily_morning_briefing，参数为 {}。",
        "第 2 步：调用完成后立即停止。"
    ].join("\n"),
    cw_market: "CN",
    cw_content: "调度每日早报生成"
});
let dailyMorningBriefingCronService;
function buildDailyMorningBriefingCronConfig(existing) {
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
function isDailyMorningBriefingCronJob(job) {
    return job?.name === DAILY_MORNING_BRIEFING_CRON_ID || job?.sessionKey === DAILY_MORNING_BRIEFING_SESSION_KEY;
}
function normalizeDailyMorningBriefingCronConfig(input) {
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
function buildDailyMorningBriefingTurnCronName(action, idempotencyKey) {
    return `daily-morning-briefing-${action}-${idempotencyKey.replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 96)}`;
}
async function removeExistingDailyMorningBriefingTurnCron(cron, name) {
    const existingJobs = (await cron.list({ includeDisabled: true }))
        .filter(job => job.name === name)
        .map(job => job.id)
        .filter((id) => typeof id === "string" && id.length > 0);
    await Promise.all(existingJobs.map(id => cron.remove(id)));
}
function isDailyMorningBriefingCronConfigCurrent(job, config) {
    return JSON.stringify(normalizeDailyMorningBriefingCronConfig(job))
        === JSON.stringify(normalizeDailyMorningBriefingCronConfig(config));
}
export async function ensureDailyMorningBriefingCron(cron) {
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
        }
        else {
            await cron.add(buildDailyMorningBriefingCronConfig());
        }
        const duplicateIds = duplicateJobs
            .map(job => job.id)
            .filter((id) => typeof id === "string" && id.length > 0);
        await Promise.all(duplicateIds.map(id => cron.remove(id)));
    }
    catch (e) {
        logger.error({ err: e }, "Failed to ensure daily morning briefing cron");
    }
}
export function registerDailyMorningBriefingCron(api) {
    api.on("gateway_start", async (_event, ctx) => {
        await ensureDailyMorningBriefingCron(ctx.getCron?.());
    });
}
export async function scheduleDailyMorningBriefingTurnCron(params) {
    const cron = dailyMorningBriefingCronService;
    if (!cron)
        throw new Error("daily morning briefing cron service is unavailable");
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
//# sourceMappingURL=dailyMorningBriefingCron.js.map