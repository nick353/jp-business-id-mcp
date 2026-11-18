// Japan Business ID MCP: 鍵なしで使える MCP サーバー（Streamable HTTP、単一 JSON の返事。SSE は使わない）。
import { InputError, corporateNumberFromBase, extractBusinessIds, validateCorporateNumber, validateInvoiceNumber } from './ids';

export interface Env {
  USAGE?: AnalyticsEngineDataset;
  USAGE_SALT?: string;
}

const MCP_PATH = '/mcp';
const SUPPORTED_PROTOCOLS = new Set(['2025-11-25', '2025-06-18', '2025-03-26']);
const DEFAULT_PROTOCOL = '2025-06-18';
const SERVER_NAME = 'jp-business-id';
const SERVER_TITLE = 'Japan Business ID (corporate number, invoice registration number)';
const SERVER_VERSION = '0.1.0';
const MAX_BODY_BYTES = 64 * 1024;
const INSTRUCTIONS =
  'Validates Japanese business identifiers offline: qualified invoice registration numbers (T + 13 digits, インボイス登録番号) and corporate numbers (法人番号). Use it when reading or issuing Japanese invoices to catch typos before payment, and follow lookup_url to confirm registration on the National Tax Agency site.';

const numberProp = (description: string) => ({ type: 'string', maxLength: 64, description });

interface Tool {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run: (input: Record<string, unknown>) => unknown;
}

const TOOLS: Tool[] = [
  {
    name: 'validate_invoice_number',
    title: 'Validate a Japanese invoice registration number',
    description: 'Check a Japanese qualified invoice registration number (適格請求書発行事業者登録番号, "T" + 13 digits) for format and check digit, tell whether it is a corporation\'s number, and return the official lookup URL. Accepts full-width characters and hyphens.',
    inputSchema: { type: 'object', properties: { number: numberProp('e.g. T8700110005901') }, required: ['number'], additionalProperties: false },
    run: (i) => validateInvoiceNumber(i.number),
  },
  {
    name: 'validate_corporate_number',
    title: 'Validate a Japanese corporate number',
    description: 'Check a Japanese corporate number (法人番号, 13 digits) with the National Tax Agency check digit formula; on a typo, return the expected check digit. Returns the official lookup URL.',
    inputSchema: { type: 'object', properties: { number: numberProp('13-digit corporate number, e.g. 8700110005901') }, required: ['number'], additionalProperties: false },
    run: (i) => validateCorporateNumber(i.number),
  },
  {
    name: 'corporate_number_from_base',
    title: 'Corporate number from registry number',
    description: 'Build the 13-digit corporate number (法人番号) from a 12-digit company registry number (会社法人等番号) by computing the check digit.',
    inputSchema: { type: 'object', properties: { base_number: numberProp('12-digit 会社法人等番号') }, required: ['base_number'], additionalProperties: false },
    run: (i) => corporateNumberFromBase(i.base_number),
  },
  {
    name: 'extract_business_ids',
    title: 'Find business IDs in a document',
    description: 'Find and validate invoice registration numbers and corporate numbers inside invoice, receipt or contract text (up to 20,000 characters).',
    inputSchema: { type: 'object', properties: { text: { type: 'string', maxLength: 20000, description: 'Document text' } }, required: ['text'], additionalProperties: false },
    run: (i) => extractBusinessIds(i.text),
  },
];
const TOOLS_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

type JsonRpcId = string | number | null;

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}
const rpcResult = (id: JsonRpcId, result: unknown) => json({ jsonrpc: '2.0', id, result });
const rpcError = (id: JsonRpcId, code: number, message: string, status = 200) => json({ jsonrpc: '2.0', id, error: { code, message } }, status);

class RpcFault extends Error {
  constructor(public code: number, message: string) { super(message); }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function toolDescriptor(t: Tool) {
  return { name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema, annotations: { readOnlyHint: true, openWorldHint: false, idempotentHint: true } };
}

function runTool(params: unknown): { content: Array<{ type: 'text'; text: string }>; structuredContent?: unknown; isError?: true } {
  if (!isRecord(params)) throw new RpcFault(-32602, 'params must be an object');
  const tool = typeof params.name === 'string' ? TOOLS_BY_NAME.get(params.name) : undefined;
  if (!tool) throw new RpcFault(-32602, `unknown tool: ${String(params.name)}`);
  const input = params.arguments === undefined ? {} : params.arguments;
  if (!isRecord(input)) throw new RpcFault(-32602, 'params.arguments must be an object');
  try {
    const result = tool.run(input);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], structuredContent: result };
  } catch (e) {
    // ツールの中の失敗は、モデルが読んで直せる結果として返す（MCP 仕様）。
    const message = e instanceof InputError ? e.message : 'internal error';
    return { content: [{ type: 'text', text: message }], isError: true };
  }
}

/** 使われた数を数える。送り元は2週ごとに変わる塩でハッシュした値だけ残す（元の IP は残さない。2週の中では同じ人を1人と数える）。 */
const PERIOD_START_MS = Date.UTC(2026, 10, 18);
const PERIOD_MS = 14 * 86_400_000;
async function recordUsage(request: Request, env: Env, method: string, tool: string | null): Promise<void> {
  if (!env.USAGE || !env.USAGE_SALT) return;
  const period = Math.floor((Date.now() - PERIOD_START_MS) / PERIOD_MS);
  const ip = request.headers.get('cf-connecting-ip') ?? '';
  const ua = request.headers.get('user-agent') ?? '';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${env.USAGE_SALT}|p${period}|${ip}|${ua}`));
  const caller = [...new Uint8Array(digest)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
  const country = (request as Request & { cf?: { country?: string } }).cf?.country ?? '';
  env.USAGE.writeDataPoint({ indexes: [caller], blobs: [method, tool ?? '', country, ua.slice(0, 60)], doubles: [1] });
}

async function handleMcp(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  if (request.method === 'GET' || request.method === 'DELETE') return json({ error: 'method_not_allowed' }, 405, { allow: 'POST' });
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, { allow: 'POST' });

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return rpcError(null, -32600, 'request too large', 413);
  let payload: unknown;
  try { payload = JSON.parse(raw); } catch { return rpcError(null, -32700, 'parse error', 400); }
  if (Array.isArray(payload)) return rpcError(null, -32600, 'batched requests are not supported', 400);
  if (!isRecord(payload)) return rpcError(null, -32600, 'invalid request', 400);

  const id: JsonRpcId = typeof payload.id === 'string' || typeof payload.id === 'number' ? payload.id : null;
  const method = typeof payload.method === 'string' ? payload.method : null;
  if (payload.jsonrpc !== '2.0' || !method) return rpcError(id, -32600, 'invalid request', 400);
  if (payload.id === undefined || payload.id === null) {
    return method.startsWith('notifications/') ? new Response(null, { status: 202 }) : rpcError(null, -32600, 'a request must carry an id', 400);
  }

  const toolName = method === 'tools/call' && isRecord(payload.params) && typeof payload.params.name === 'string' ? payload.params.name : null;
  if (method === 'initialize' || method === 'tools/call') ctx.waitUntil(recordUsage(request, env, method, toolName).catch(() => undefined));

  try {
    switch (method) {
      case 'initialize': {
        const asked = isRecord(payload.params) ? payload.params.protocolVersion : null;
        return rpcResult(id, {
          protocolVersion: typeof asked === 'string' && SUPPORTED_PROTOCOLS.has(asked) ? asked : DEFAULT_PROTOCOL,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: SERVER_NAME, title: SERVER_TITLE, version: SERVER_VERSION },
          instructions: INSTRUCTIONS,
        });
      }
      case 'ping':
        return rpcResult(id, {});
      case 'tools/list':
        return rpcResult(id, { tools: TOOLS.map(toolDescriptor) });
      case 'tools/call':
        return rpcResult(id, runTool(payload.params));
      default:
        return rpcError(id, -32601, `method not found: ${method}`);
    }
  } catch (e) {
    if (e instanceof RpcFault) return rpcError(id, e.code, e.message);
    return rpcError(id, -32603, 'internal error');
  }
}

const LANDING = `Japan Business ID MCP server (no API key).
Endpoint: POST /mcp (Streamable HTTP)
Tools: ${TOOLS.map((t) => t.name).join(', ')}
`;

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === MCP_PATH) return handleMcp(request, env, ctx);
    if (url.pathname === '/' && request.method === 'GET') return new Response(LANDING, { headers: { 'content-type': 'text/plain; charset=utf-8' } });
    return json({ error: 'not_found' }, 404);
  },
};
