import type { OpenClawConfig } from "openclaw/plugin-sdk/core";
import { HEDGEHOG_AGENT_ID, listRegisteredAgentToolNames } from "./openclawConstants.js";

type AgentEntry = {
	id: string;
	tools?: {
		allow?: string[];
		alsoAllow?: string[];
		[key: string]: unknown;
	};
	[key: string]: unknown;
};

export type HedgehogAgentToolAllowMigration = {
	config: OpenClawConfig;
	changes: string[];
};

function uniqueStrings(values: readonly string[]): string[] {
	return Array.from(new Set(values));
}

function withRegisteredTools(agent: AgentEntry): { agent: AgentEntry; changed: boolean; added: string[] } {
	const tools = agent.tools || {};
	const registeredToolNames = listRegisteredAgentToolNames();
	const existing = Array.isArray(tools.alsoAllow) ? tools.alsoAllow : [];
	const existingSet = new Set(existing);
	const added = registeredToolNames.filter((name) => !existingSet.has(name));
	const nextAlsoAllow = uniqueStrings([...existing, ...registeredToolNames]);
	return {
		agent: {
			...agent,
			tools: {
				...tools,
				alsoAllow: nextAlsoAllow
			}
		},
		changed: added.length > 0,
		added
	};
}

export function ensureRegisteredToolsAllowedInConfig(config: OpenClawConfig): HedgehogAgentToolAllowMigration | null {
	const agents = config.agents || {};
	const list = Array.isArray(agents.list) ? agents.list as AgentEntry[] : [];
	const existingIndex = list.findIndex((agent) => agent?.id === HEDGEHOG_AGENT_ID);
	const nextList = [...list];
	let added: string[] = [];

	if (existingIndex >= 0) {
		const result = withRegisteredTools(nextList[existingIndex]);
		if (!result.changed) return null;
		nextList[existingIndex] = result.agent;
		added = result.added;
	} else {
		const result = withRegisteredTools({ id: HEDGEHOG_AGENT_ID });
		nextList.push(result.agent);
		added = result.added;
	}

	return {
		config: {
			...config,
			agents: {
				...agents,
				list: nextList
			}
		},
		changes: [
			`Added ${added.join(", ")} to agents.list[id=${HEDGEHOG_AGENT_ID}].tools.alsoAllow.`
		]
	};
}
