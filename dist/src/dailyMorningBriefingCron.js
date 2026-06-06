import { logger } from "./core/logger.js";
import { CHART_OUTPUT_GUIDANCE } from "./features/chartOutput.js";
import { HEDGEHOG_AGENT_ID } from "./openclawConstants.js";
const DAILY_MORNING_BRIEFING_CRON_ID = "hedgehog_daily_morning_briefing";
const DAILY_MORNING_BRIEFING_SESSION_KEY = `cron:${DAILY_MORNING_BRIEFING_CRON_ID}`;
const DAILY_MORNING_BRIEFING_SKILL = "hedgehog-daily-morning-briefing";
const DAILY_MORNING_BRIEFING_MESSAGE = JSON.stringify({
    cw_system_prompt: [
        "开始分析前必须先调用 save_daily_morning_briefing，参数为 {\"status\":\"generating\",\"content\":\"\"}；如果返回 skipped=true，必须立即停止，不要继续调用 skill 或生成正文。",
        `必须触发并使用 ${DAILY_MORNING_BRIEFING_SKILL} skill 生成盘前简报。`,
        "生成成功后必须调用 save_daily_morning_briefing，参数为 {\"status\":\"completed\",\"content\":\"...\"}，content 传最终完整早报正文。",
        "生成失败后必须调用 save_daily_morning_briefing，参数为 {\"status\":\"failed\",\"content\":\"...\"}，content 存放完整错误信息。",
        "如果最终内容包含 [图表数据]，正文必须已经包含所有对应图表占位符。"
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
            expr: "30 7 * * *",
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