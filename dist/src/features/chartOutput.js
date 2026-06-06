export function ensureChartPlaceholdersInBody(content) {
    const chartDataMatch = content.match(/(?:\*\*)?\[图表数据\](?:\*\*)?/);
    if (!chartDataMatch || typeof chartDataMatch.index !== "number")
        return content;
    const chartDataStart = chartDataMatch.index;
    const body = content.slice(0, chartDataStart);
    const chartData = content.slice(chartDataStart);
    const placeholders = Array.from(chartData.matchAll(/\{图\d+\}\s*:/g), match => match[0].replace(/\s*:$/, ""));
    const uniquePlaceholders = [...new Set(placeholders)];
    const missingPlaceholders = uniquePlaceholders.filter(placeholder => !body.includes(placeholder));
    if (missingPlaceholders.length === 0)
        return content;
    const insertion = [
        "## 图表",
        "",
        ...missingPlaceholders.flatMap(placeholder => [placeholder, ""])
    ].join("\n");
    return `${body.trimEnd()}\n\n${insertion}\n${chartData.trimStart()}`;
}
export const CHART_OUTPUT_GUIDANCE = [
    "正文中如果生成任何图表，必须在对应分析段落先给出明确金融结论，并在结论后单独放置图表占位符，例如：",
    "{图1}",
    "每个图表占位符前后都必须换行；正文占位符与尾部 [图表数据] 编号必须一一对应，禁止只在尾部输出图表数据。",
    "图表生成遵循投研可视化原则：仅在有助于趋势识别、横向比较、结构拆解或风险暴露说明时生成。",
    "图表数据必须可追溯，来源限于工具返回、资讯原文、上下文已给出的数值，或正文已明确披露的计算结果；禁止使用示意性、编造型或装饰性数据。",
    "图表数量控制在 1-3 张；无可靠数值数据时不生成图表。",
    "图表标题必须明确市场、资产、指标与时间范围；xAxis、series、legend、title 必须与正文结论和数据口径一致。",
    "图表类型只能取以下值之一：",
    "[\"Line\",\"Bar\",\"Area\",\"Pie\",\"Donut\",\"Horizontal Bar\",\"Radar\",\"Histogram\",\"Scatter Plot\",\"Bubble\"]",
    "图表类型选择：趋势变化用 Line 或 Area；横向比较用 Bar 或 Horizontal Bar；结构占比用 Pie 或 Donut；多维评分用 Radar；分布、相关性、离群点用 Histogram、Scatter Plot 或 Bubble。",
    "如果生成图表，结尾追加 [图表数据]，不要使用代码块，格式必须严格为：",
    "{图1}: {\"chart\":\"Line\",\"option\":{...}}；{图2}: {\"chart\":\"Bar\",\"option\":{...}}",
    "其中 chart 必须是上面的图表类型之一，option 必须是纯 JSON，不允许 JS 函数、formatter 函数或注释。"
].join("\n");
//# sourceMappingURL=chartOutput.js.map