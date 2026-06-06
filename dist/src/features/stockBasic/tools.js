import { getDB } from "../../core/database.js";
import { GetStockBasicListParamsSchema, GetStockBasicInfoParamsSchema, SyncStockBasicParamsSchema } from "./schema.js";
const GetStockBasicInfoAgentToolSchema = {
    type: "object",
    additionalProperties: false,
    required: ["stock_code"],
    properties: {
        stock_code: { type: "string", description: "股票代码，例如：000001.SZ 或 600000.SH" }
    }
};
function normalizeStockBasic(stock) {
    return {
        ...stock,
        stock_code: stock.stock_code.trim().toUpperCase().replace(/\.SS$/i, ".SH"),
        symbol: stock.symbol.trim(),
        exchange: stock.exchange.trim().toUpperCase(),
        name: stock.name.trim(),
        fullname: stock.fullname.trim(),
        enname: stock.enname.trim(),
        cnspell: stock.cnspell.trim().toUpperCase()
    };
}
function escapeLike(value) {
    return value.replace(/[\\%_]/g, "\\$&");
}
export const stockBasicTools = {
    sync_stock_basic: {
        name: "sync_stock_basic",
        description: "批量同步证券基础资料主数据。系统以 stock_code 作为唯一标识执行新增或覆盖更新，适用于初始化或定期刷新股票代码、名称、交易所、行业、上市日期等基础字段。",
        parameters: SyncStockBasicParamsSchema,
        registerTool: false,
        async execute(params) {
            const args = SyncStockBasicParamsSchema.parse(params);
            const db = getDB();
            const stmt = db.prepare(`
				INSERT INTO stock_basic (
					stock_code,
					symbol,
					name,
					fullname,
					enname,
					cnspell,
					exchange,
					market,
					industry,
					area,
					curr_type,
					list_date,
					is_hs,
					act_name,
					act_ent_type
				)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
				ON CONFLICT(stock_code) DO UPDATE SET
					symbol = excluded.symbol,
					name = excluded.name,
					fullname = excluded.fullname,
					enname = excluded.enname,
					cnspell = excluded.cnspell,
					exchange = excluded.exchange,
					market = excluded.market,
					industry = excluded.industry,
					area = excluded.area,
					curr_type = excluded.curr_type,
					list_date = excluded.list_date,
					is_hs = excluded.is_hs,
					act_name = excluded.act_name,
					act_ent_type = excluded.act_ent_type,
					updatedAt = STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')
			`);
            if (db.inTransaction)
                db.exec("ROLLBACK");
            db.exec("BEGIN TRANSACTION");
            try {
                for (const rawStock of args.stocks) {
                    const stock = normalizeStockBasic(rawStock);
                    stmt.run(stock.stock_code, stock.symbol, stock.name, stock.fullname, stock.enname, stock.cnspell, stock.exchange, stock.market, stock.industry, stock.area, stock.curr_type, stock.list_date, stock.is_hs, stock.act_name, stock.act_ent_type);
                }
                db.exec("COMMIT");
                return JSON.stringify({ success: true, synced: args.stocks.length });
            }
            catch (e) {
                if (db.inTransaction)
                    db.exec("ROLLBACK");
                return JSON.stringify({ success: false, error: e.message });
            }
        }
    },
    get_stock_basic_list: {
        name: "get_stock_basic_list",
        description: "查询证券基础资料全量列表。返回股票代码、证券简称、公司全称、交易所、市场板块、行业及上市日期等基础字段，用于前端缓存、下拉选择或基础数据校验。",
        parameters: GetStockBasicListParamsSchema,
        registerTool: false,
        async execute(params) {
            GetStockBasicListParamsSchema.parse(params);
            const db = getDB();
            const rows = db.prepare(`
				SELECT stock_code, symbol, name, fullname, enname, cnspell, exchange, market, industry, area, curr_type, list_date, is_hs, act_name, act_ent_type, createdAt, updatedAt
				FROM stock_basic
				ORDER BY exchange ASC, symbol ASC
			`).all();
            return JSON.stringify({ success: true, data: rows });
        }
    },
    get_stock_basic_info: {
        name: "get_stock_basic_info",
        label: "查询股票基本信息",
        description: "根据股票代码查询证券基础资料。",
        parameters: GetStockBasicInfoAgentToolSchema,
        registerTool: true,
        async execute(params) {
            const args = GetStockBasicInfoParamsSchema.parse(params);
            const db = getDB();
            const code = args.stock_code.trim().toUpperCase().replace(/\.SS$/i, ".SH");
            const row = db.prepare(`
				SELECT stock_code, name, enname, exchange, market, industry, is_hs
				FROM stock_basic
				WHERE stock_code = ?
			`).get(code);
            return JSON.stringify({ success: true, data: row || null });
        }
    }
};
//# sourceMappingURL=tools.js.map