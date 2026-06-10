import { logger } from "./core/logger.js";
import { CHART_OUTPUT_GUIDANCE } from "./features/chartOutput.js";
import { HEDGEHOG_AGENT_ID } from "./openclawConstants.js";
const DAILY_MORNING_BRIEFING_CRON_ID = "hedgehog_daily_morning_briefing";
const DAILY_MORNING_BRIEFING_SESSION_KEY = `cron:${DAILY_MORNING_BRIEFING_CRON_ID}`;
const DAILY_MORNING_BRIEFING_SKILL = "hedgehog-daily-morning-briefing";
const DAILY_MORNING_BRIEFING_MESSAGE = JSON.stringify({
    cw_system_prompt: [
        "必须先调用 dispatch_daily_morning_briefing，参数为 {}。",
        "dispatch_daily_morning_briefing 会负责判断 7:30 前跳过、当天已完成跳过、当天生成中则唤醒当天生成会话、当天未触发则启动当天生成会话。",
        "调用 dispatch_daily_morning_briefing 后必须立即停止，不要直接调用 save_daily_morning_briefing、不要直接触发 skill、不要自行生成早报正文。",
        `真正的每日早报生成会在按日期隔离的会话中触发并使用 ${DAILY_MORNING_BRIEFING_SKILL} skill 完成。`
    ].join("\n"),
    cw_market: "CN",
    cw_content: [
        "生成每日早报"
    ].join("\n"),
    cw_output: [
        `输出结构以 ${DAILY_MORNING_BRIEFING_SKILL} skill 的交付模板为准。`,
        CHART_OUTPUT_GUIDANCE
    ].join("\n")
});
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
            expr: "*/30 * * * *",
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
        deleteAfterRun: false
    };
}
function isDailyMorningBriefingCronJob(job) {
    return job?.name === DAILY_MORNING_BRIEFING_CRON_ID || job?.sessionKey === DAILY_MORNING_BRIEFING_SESSION_KEY;
}
export async function ensureDailyMorningBriefingCron(cron) {
    try {
        if (!cron) {
            logger.warn("Daily morning briefing cron was not scheduled because OpenClaw cron API is unavailable");
            return;
        }
        const existingJobs = (await cron.list({ includeDisabled: true })).filter(isDailyMorningBriefingCronJob);
        const [primaryJob, ...duplicateJobs] = existingJobs;
        if (primaryJob?.id) {
            await cron.update(primaryJob.id, buildDailyMorningBriefingCronConfig(primaryJob));
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
//# sourceMappingURL=dailyMorningBriefingCron.js.map