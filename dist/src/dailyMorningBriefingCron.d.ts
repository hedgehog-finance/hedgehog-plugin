import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
type CronServiceLike = {
    list(opts?: {
        includeDisabled?: boolean;
    }): Promise<CronJobLike[]>;
    add(input: DailyMorningBriefingCronConfig): Promise<unknown>;
    update(id: string, patch: DailyMorningBriefingCronConfig): Promise<unknown>;
    remove(id: string): Promise<{
        ok?: boolean;
        removed?: boolean;
    } | undefined>;
};
type CronJobLike = {
    id?: string;
    agentId?: string;
    name?: string;
    description?: string;
    enabled?: boolean;
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
    deleteAfterRun?: boolean;
    sessionKey?: string;
    schedule?: {
        kind?: string;
        expr?: string;
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
    deleteAfterRun: false;
};
export declare function ensureDailyMorningBriefingCron(cron: CronServiceLike | undefined): Promise<void>;
export declare function registerDailyMorningBriefingCron(api: OpenClawPluginApi): void;
export {};
