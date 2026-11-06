// Every error is `{ error: DataError }`.
import type { ServerResponse } from "node:http";
import { z } from "zod";

import { DATA_LIMITS, type DataError, type DataErrorCode } from "../../shared/data-surface.ts";
import { PASS, type RouteContext, type RouteHandler } from "../routes/table.ts";
import type { DataSheetRegistry } from "./sheet.ts";
import { renderCard, resultRelation, toDataError, type DataContext } from "./tools.ts";
import { DataFailure, type ChartCompiler, type ChartRenderer, type DataEngine, type VegaLiteValidator } from "./types.ts";

export interface DataRouteDeps {
  bot(id: string): { id: string; cwd?: string } | null | undefined;
  engine: Pick<DataEngine, "unavailable" | "forBot">;
  sheets: Pick<DataSheetRegistry, "for">;
  compileChart: ChartCompiler;
  validateVegaLite: VegaLiteValidator;
  renderer: ChartRenderer;
  exportRoots(bot: { id: string; cwd?: string }): string[];
}

const ROUTE = /^\/api\/bots\/([\w-]+)\/data(?:\/(.+))?$/;
const CARD_ID = /^c_\d+$/;
const identifier = z.string().min(1).max(300);
const cardId = z.string().regex(CARD_ID);
const pageBody = z.object({
  table: identifier.optional(),
  cardId: cardId.optional(),
  offset: z.number().int().min(0),
  limit: z.number().int().min(1).max(DATA_LIMITS.pageSize),
  sort: z.object({ column: z.string().max(300), direction: z.enum(["asc", "desc"]) }).strict().optional(),
  filter: z.string().max(200).optional(),
  filterColumn: identifier.optional(),
}).strict();

export function dataErrorStatus(code: DataErrorCode): number {
  switch (code) {
    case "invalid_input": return 400;
    case "card_not_found": case "table_not_found": case "source_not_found": return 404;
    case "write_refused": case "cancelled": return 409;
    case "engine_unavailable": case "timeout": return 503;
    default: return 422;
  }
}

export function createDataRoutes(deps: DataRouteDeps): RouteHandler {
  const replyError = (ctx: RouteContext, error: DataError) => ctx.json(ctx.res, dataErrorStatus(error.code), { error });
  const invalid = (message: string): DataError => ({ code: "invalid_input", message });

  /** Undefined means a 400 was already sent. */
  async function body<T>(ctx: RouteContext, schema: z.ZodType<T>): Promise<T | undefined> {
    let raw: unknown;
    try {
      raw = await ctx.readBody(ctx.req, 256_000);
    } catch (error) {
      replyError(ctx, invalid((error as Error).message || "The request body is not JSON."));
      return undefined;
    }
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      replyError(ctx, invalid(parsed.error.issues.map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`).join("; ")));
      return undefined;
    }
    return parsed.data;
  }

  return async (ctx) => {
    const match = ROUTE.exec(ctx.path);
    if (!match) return PASS;
    const { res, method } = ctx;
    res.setHeader("cache-control", "no-store");
    const bot = deps.bot(match[1]!);
    if (!bot) return replyError(ctx, { code: "source_not_found", message: "no such bot" });
    const unavailable = deps.engine.unavailable();
    if (unavailable !== null) return replyError(ctx, { code: "engine_unavailable", message: unavailable });
    const rest = match[2] ?? "";
    const [head, second, third] = rest.split("/");
    const abort = new AbortController();
    res.once("close", () => { if (!res.writableEnded) abort.abort(); });
    const database = await deps.engine.forBot(bot.id);
    const sheet = deps.sheets.for(bot.id);
    const context: DataContext = {
      database, sheet, compileChart: deps.compileChart, validateVegaLite: deps.validateVegaLite, renderer: deps.renderer,
      exportRoots: () => deps.exportRoots(bot), signal: abort.signal, connection: "panel", by: "person",
    };
    try {
      if (rest === "" && method === "GET") {
        return ctx.json(res, 200, { sheet: sheet.sheet(), tables: await database.listTables() });
      }
      if (rest === "page" && method === "POST") {
        const input = await body(ctx, pageBody);
        if (!input) return;
        if (Boolean(input.table) === Boolean(input.cardId)) return replyError(ctx, invalid("Give exactly one of table or cardId."));
        let target: string;
        if (input.cardId) {
          const card = sheet.card(input.cardId);
          if (!card) return replyError(ctx, { code: "card_not_found", message: `No card ${input.cardId} on the sheet.` });
          if (!card.result) return replyError(ctx, invalid(`${card.id} has no result to page${card.error ? `: ${card.error.message}` : "."}`));
          target = resultRelation(card.result);
        } else {
          target = await database.resolveTable(input.table!);
        }
        return ctx.json(res, 200, await database.page(target, { offset: input.offset, limit: input.limit, sort: input.sort, filter: input.filter, filterColumn: input.filterColumn, signal: abort.signal }));
      }
      if (head === "cards" && second && CARD_ID.test(second)) {
        const card = sheet.card(second);
        if (!card) return replyError(ctx, { code: "card_not_found", message: `No card ${second} on the sheet.` });
        if (third === "image" && method === "GET") {
          const query = ctx.url.searchParams;
          const format = query.get("format") === "svg" ? "svg" : "png";
          const width = Number(query.get("width"));
          const scale = Number(query.get("scale"));
          const image = await renderCard(context, card, format, {
            theme: query.get("theme") === "dark" ? "dark" : "light",
            width: Number.isFinite(width) && width >= 100 && width <= 4000 ? Math.trunc(width) : undefined,
            scale: Number.isFinite(scale) && scale >= 1 && scale <= 4 ? scale : undefined,
          });
          return sendImage(res, format, image);
        }
      }
      return replyError(ctx, { code: "invalid_input", message: `No ${method} ${ctx.path} route.` });
    } catch (error) {
      if (error instanceof DataFailure || abort.signal.aborted) return replyError(ctx, toDataError(error, undefined, abort.signal));
      throw error;
    }
  };
}

function sendImage(res: ServerResponse, format: "png" | "svg", image: string | Buffer): void {
  const bytes = typeof image === "string" ? Buffer.from(image, "utf8") : image;
  res.writeHead(200, { "content-type": format === "svg" ? "image/svg+xml; charset=utf-8" : "image/png", "content-length": bytes.length });
  res.end(bytes);
}
