import { watchlistTools } from "./watchlist/tools.js";
import { profileLibraryTools } from "./profileLibrary/tools.js";
import { noteTools } from "./notes/tools.js";
import { stockAnalysisTools } from "./stockAnalysis/tools.js";
import { pluginInfoTools } from "./pluginInfo/tools.js";
import { dailyMorningBriefingTools } from "./dailyMorningBriefing/tools.js";
import { stockBasicTools } from "./stockBasic/tools.js";
import { informationVerificationTools } from "./informationVerification/tools.js";
import { deepReasoningTools } from "./deepReasoning/tools.js";
import { chatSessionHistoryTools } from "./chatSessionHistory/tools.js";

export interface RuntimeTool {
    name: string;
    label?: string;
    description: string;
    parameters: unknown;
    registerTool?: boolean;
    agentToolTarget?: "main";
    execute(params: unknown, ctx?: { userId?: string; sessionKey?: string; sessionId?: string; runId?: string }): Promise<string>;
}

export const allFeaturesTools: Record<string, RuntimeTool> = {
    ...watchlistTools,
    ...profileLibraryTools,
    ...noteTools,
    ...stockAnalysisTools,
    ...pluginInfoTools,
    ...dailyMorningBriefingTools,
    ...stockBasicTools,
    ...informationVerificationTools,
    ...deepReasoningTools,
    ...chatSessionHistoryTools
};
