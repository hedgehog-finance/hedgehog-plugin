import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
type CronServiceLike = {
    list(opts?: {
        includeDisabled?: boolean;
    }): Promise<CronJobLike[]>;
    add(input: DailyMorningBriefingCronConfig | DailyMorningBriefingTurnCronConfig): Promise<unknown>;
    update(id: string, patch: DailyMorningBriefingCronConfig): Promise<unknown>;
    remove(id: string): Promise<{
        ok?: boolean;
        removed?: boolean;
    } | undefined>;
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
export declare function ensureDailyMorningBriefingCron(cron: CronServiceLike | undefined): Promise<void>;
export declare function registerDailyMorningBriefingCron(api: OpenClawPluginApi): void;
export declare function scheduleDailyMorningBriefingTurnCron(params: {
    action: "start" | "continue";
    sessionKey: string;
    message: string;
    idempotencyKey: string;
}): Promise<void>;
export {};
