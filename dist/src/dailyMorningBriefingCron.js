import { loadCronStore, resolveCronStorePath, saveCronStore } from "openclaw/plugin-sdk/cron-store-runtime";
import { logger } from "./core/logger.js";
import { HEDGEHOG_AGENT_ID, listRegisteredAgentToolNames } from "./openclawConstants.js";
const DAILY_MORNING_BRIEFING_CRON_ID = "hedgehog_daily_morning_briefing";
const DAILY_MORNING_BRIEFING_SESSION_KEY = `cron:${DAILY_MORNING_BRIEFING_CRON_ID}`;
const DAILY_MORNING_BRIEFING_MESSAGE = JSON.stringify({
    cw_system_prompt: [
        "生成完成后必须调用 save_daily_morning_briefing 将最终结果写入数据库。",
        "如果最终内容包含 [图表数据]，正文必须已经包含所有对应图表占位符。"
    ].join("\n"),
    cw_market: "CN",
    cw_context: {
        watchlist_source: {
            tool: "get_watchlist",
            params: {},
            instruction: "请先调用 get_watchlist，参数传空对象 {}，获取当前全量自选股，并将返回结果的 data 数组作为本次分析范围。"
        }
    },
    cw_content: [
        "每日早报",
        "请触发并使用 hedgehog-daily-morning-briefing skill 生成盘前简报。"
    ].join("\n"),
    cw_output: [
        "正文中如果生成任何图表，必须在对应分析段落的合适位置单独放置图表占位符，例如：",
        "{图1}",
        "每个图表占位符前后都必须换行。",
        "禁止只在尾部输出图表数据而正文没有对应占位符；这属于格式错误。",
        "正文中出现的每一个图表占位符，必须在尾部 [图表数据] 中有完全相同编号的数据；[图表数据] 中出现的每一个编号，也必须已在正文中出现。",
        "保存或返回最终内容前必须逐项自检：如果 [图表数据] 有 {图1}:，正文必须包含单独一行 {图1}；{图2}、{图3} 依此类推。",
        "图表类型只能取以下值之一：",
        "[\"Line\",\"Bar\",\"Area\",\"Pie\",\"Donut\",\"Horizontal Bar\",\"Radar\",\"Histogram\",\"Scatter Plot\",\"Bubble\"]",
        "如果生成图表，结尾追加 [图表数据]，不要使用代码块，格式必须严格为：",
        "{图1}: {\"chart\":\"Line\",\"option\":{...}}；{图2}: {\"chart\":\"Bar\",\"option\":{...}}",
        "其中 chart 必须是上面的图表类型之一，option 必须是纯 JSON，不允许 JS 函数、formatter 函数或注释。",
        "不要为了满足格式硬编固定图表；只在正文内容需要折线、柱状、面积、饼图等可视化表达时生成对应图表。",
        "调用 save_daily_morning_briefing 保存入库时，参数必须只包含：",
        "{\"content\":\"...\"}",
        "content 传最终完整早报正文。"
    ].join("\n")
});
function buildDailyMorningBriefingCronJob(nowMs) {
    return {
        id: DAILY_MORNING_BRIEFING_CRON_ID,
        agentId: HEDGEHOG_AGENT_ID,
        sessionKey: DAILY_MORNING_BRIEFING_SESSION_KEY,
        name: DAILY_MORNING_BRIEFING_CRON_ID,
        description: "触发 hedgehog-daily-morning-briefing skill 生成每日盘前早报并入库。",
        enabled: true,
        createdAtMs: nowMs,
        updatedAtMs: nowMs,
        schedule: {
            kind: "cron",
            expr: "30 7 * * *"
        },
        sessionTarget: "isolated",
        wakeMode: "now",
        payload: {
            kind: "agentTurn",
            message: DAILY_MORNING_BRIEFING_MESSAGE,
            lightContext: true,
            timeoutSeconds: 0,
            toolsAllow: listRegisteredAgentToolNames()
        },
        delivery: {
            mode: "none"
        },
        state: {}
    };
}
function comparableCronJobConfig(job) {
    return {
        id: job.id,
        agentId: job.agentId,
        sessionKey: job.sessionKey,
        name: job.name,
        description: job.description,
        schedule: job.schedule,
        sessionTarget: job.sessionTarget,
        wakeMode: job.wakeMode,
        payload: job.payload,
        delivery: job.delivery,
        deleteAfterRun: job.deleteAfterRun
    };
}
function cronJobConfigChanged(existing, nextJob) {
    const existingConfig = comparableCronJobConfig({
        ...existing,
        id: existing.id || nextJob.id
    });
    const nextConfig = comparableCronJobConfig(nextJob);
    return JSON.stringify(existingConfig) !== JSON.stringify(nextConfig);
}
export async function ensureDailyMorningBriefingCron(runtime) {
    try {
        const cfg = runtime.config.current ? runtime.config.current() : runtime.config.loadConfig();
        const storePath = resolveCronStorePath(cfg.cron?.store);
        const store = await loadCronStore(storePath);
        const nowMs = Date.now();
        const nextJob = buildDailyMorningBriefingCronJob(nowMs);
        const existingIndex = store.jobs.findIndex(job => job.id === DAILY_MORNING_BRIEFING_CRON_ID || job.name === DAILY_MORNING_BRIEFING_CRON_ID);
        if (existingIndex >= 0) {
            const existing = store.jobs[existingIndex];
            if (!cronJobConfigChanged(existing, nextJob))
                return;
            store.jobs[existingIndex] = {
                ...existing,
                ...nextJob,
                id: nextJob.id,
                sessionKey: nextJob.sessionKey,
                payload: nextJob.payload,
                enabled: typeof existing.enabled === "boolean" ? existing.enabled : true,
                createdAtMs: typeof existing.createdAtMs === "number" ? existing.createdAtMs : nowMs,
                updatedAtMs: nowMs,
                state: existing.state || {}
            };
        }
        else {
            store.jobs.push(nextJob);
        }
        await saveCronStore(storePath, store);
    }
    catch (e) {
        logger.error({ err: e }, "Failed to ensure daily morning briefing cron");
    }
}
//# sourceMappingURL=dailyMorningBriefingCron.js.map