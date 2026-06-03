import { HEDGEHOG_AGENT_ID, listRegisteredAgentToolNames } from "./openclawConstants.js";
function uniqueStrings(values) {
    return Array.from(new Set(values));
}
function withRegisteredTools(agent) {
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
export function ensureRegisteredToolsAllowedInConfig(config) {
    const agents = config.agents || {};
    const list = Array.isArray(agents.list) ? agents.list : [];
    const existingIndex = list.findIndex((agent) => agent?.id === HEDGEHOG_AGENT_ID);
    const nextList = [...list];
    let added = [];
    if (existingIndex >= 0) {
        const result = withRegisteredTools(nextList[existingIndex]);
        if (!result.changed)
            return null;
        nextList[existingIndex] = result.agent;
        added = result.added;
    }
    else {
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
//# sourceMappingURL=openclawConfig.js.map