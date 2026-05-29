import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "openclaw/plugin-sdk/zod";
const GetPluginVersionParamsSchema = z.object({}).nullish();
let cachedPluginVersion = null;
function findPackageJsonPath(startDir) {
    let currentDir = startDir;
    while (true) {
        const candidate = path.join(currentDir, "package.json");
        if (fs.existsSync(candidate))
            return candidate;
        const parentDir = path.dirname(currentDir);
        if (parentDir === currentDir)
            return null;
        currentDir = parentDir;
    }
}
function getPluginVersion() {
    if (cachedPluginVersion)
        return cachedPluginVersion;
    const moduleDir = path.dirname(fileURLToPath(import.meta.url));
    const packageJsonPath = findPackageJsonPath(moduleDir);
    if (!packageJsonPath) {
        throw new Error("无法找到插件 package.json");
    }
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
    if (typeof packageJson.version !== "string" || !packageJson.version.trim()) {
        throw new Error("插件 package.json 缺少有效版本号");
    }
    cachedPluginVersion = packageJson.version.trim();
    return cachedPluginVersion;
}
export const pluginInfoTools = {
    get_plugin_version: {
        name: "get_plugin_version",
        description: "获取当前 Hedgehog 插件版本号",
        parameters: GetPluginVersionParamsSchema,
        registerTool: false,
        async execute(params) {
            GetPluginVersionParamsSchema.parse(params);
            return JSON.stringify({
                success: true,
                version: getPluginVersion()
            });
        }
    }
};
//# sourceMappingURL=tools.js.map