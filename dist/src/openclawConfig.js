import { HEDGEHOG_AGENT_ID, MAIN_AGENT_EXTRA_TOOL_NAMES, MAIN_AGENT_ID, listRegisteredAgentToolNames } from "./openclawConstants.js";
function uniqueStrings(values) {
    return Array.from(new Set(values));
}
function withAllowedTools(agent, toolNames) {
    const tools = agent.tools || {};
    const existing = Array.isArray(tools.alsoAllow) ? tools.alsoAllow : [];
    const existingSet = new Set(existing);
    const added = toolNames.filter((name) => !existingSet.has(name));
    const nextAlsoAllow = uniqueStrings([...existing, ...toolNames]);
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
function withRegisteredTools(agent) {
    return withAllowedTools(agent, listRegisteredAgentToolNames());
}
function upsertAgentTools(list, agentId, toolNames) {
    const existingIndex = list.findIndex((agent) => agent?.id === agentId);
    if (existingIndex >= 0) {
        const result = withAllowedTools(list[existingIndex], toolNames);
        if (!result.changed)
            return { changed: false, added: [] };
        list[existingIndex] = result.agent;
        return { changed: true, added: result.added };
    }
    const result = withAllowedTools({ id: agentId }, toolNames);
    list.push(result.agent);
    return { changed: result.changed, added: result.added };
}
export function ensureRegisteredToolsAllowedInConfig(config) {
    const agents = config.agents || {};
    const list = Array.isArray(agents.list) ? agents.list : [];
    const existingIndex = list.findIndex((agent) => agent?.id === HEDGEHOG_AGENT_ID);
    const nextList = [...list];
    const changes = [];
    if (existingIndex >= 0) {
        const result = withRegisteredTools(nextList[existingIndex]);
        if (result.changed) {
            nextList[existingIndex] = result.agent;
            changes.push(`Added ${result.added.join(", ")} to agents.list[id=${HEDGEHOG_AGENT_ID}].tools.alsoAllow.`);
        }
    }
    else {
        const result = withRegisteredTools({ id: HEDGEHOG_AGENT_ID });
        nextList.push(result.agent);
        changes.push(`Added ${result.added.join(", ")} to agents.list[id=${HEDGEHOG_AGENT_ID}].tools.alsoAllow.`);
    }
    const mainResult = upsertAgentTools(nextList, MAIN_AGENT_ID, MAIN_AGENT_EXTRA_TOOL_NAMES);
    if (mainResult.changed) {
        changes.push(`Added ${mainResult.added.join(", ")} to agents.list[id=${MAIN_AGENT_ID}].tools.alsoAllow.`);
    }
    if (changes.length === 0)
        return null;
    return {
        config: {
            ...config,
            agents: {
                ...agents,
                list: nextList
            }
        },
        changes
    };
}
//# sourceMappingURL=openclawConfig.js.map