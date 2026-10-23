import {
  EMcpAuth,
  EMcpTransport,
  type McpEntry,
  type McpLocalSpec,
  type McpRemoteSpec,
  type McpSpec,
} from '../../../fixtures/settings-mcp'
import { hasInputRef, hasRef, rewriteRefs } from './mcp-refs'

export enum EMcpImportKind {
  Empty = 'empty',
  Invalid = 'invalid',
  NeedsName = 'needs-name',
  Servers = 'servers',
}

export enum EMcpImportStatus {
  Ready = 'ready',
  Error = 'error',
}

export type McpDraft = { name: string; enabled: boolean; spec: McpSpec }

export type McpImportEntry =
  | { status: EMcpImportStatus.Ready; name: string; draft: McpDraft; notes: string[] }
  | { status: EMcpImportStatus.Error; name: string; error: string }

export type McpImportResult =
  | { kind: EMcpImportKind.Empty }
  | { kind: EMcpImportKind.Invalid; message: string }
  | { kind: EMcpImportKind.NeedsName; entries: McpImportEntry[] }
  | { kind: EMcpImportKind.Servers; entries: McpImportEntry[] }

type JsonRecord = Record<string, unknown>
type Converted = { ok: true; spec: McpSpec; notes: string[] } | { ok: false; error: string }
type Fields<T> = { ok: true; value: T; refs: string[] } | { ok: false; error: string }
type Kind = { ok: true; transport: EMcpTransport; notes: string[] } | { ok: false; error: string }

const NAME = /^[a-zA-Z0-9_-]+$/
const SECRET_KEY = /authorization|token|secret|key|password/i
const BEARER = /^Bearer\s+(.+)$/i
const WS_ERROR = "WebSocket servers aren't supported."
const INPUT_ERROR = 'Uses ${input:…}. Use ${NAME} to reference a secret.'

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(record: JsonRecord, key: string): string | undefined {
  const value = record[key]
  return typeof value === 'string' ? value : undefined
}

function scalarToString(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return undefined
}

function resolveKind({ type, record }: { type: string | undefined; record: JsonRecord }): Kind {
  if (type === undefined) {
    if (typeof record.command === 'string')
      return { ok: true, transport: EMcpTransport.Stdio, notes: [] }
    if (typeof record.url === 'string')
      return { ok: true, transport: EMcpTransport.Http, notes: [] }
    return { ok: false, error: 'Needs a command or a url.' }
  }
  const lower = type.toLowerCase()
  if (lower === 'stdio') return { ok: true, transport: EMcpTransport.Stdio, notes: [] }
  if (lower === 'http' || lower === 'streamable-http') {
    return { ok: true, transport: EMcpTransport.Http, notes: [] }
  }
  if (lower === 'sse') {
    return { ok: true, transport: EMcpTransport.Http, notes: ['Imported as Streamable HTTP.'] }
  }
  if (lower === 'ws' || lower === 'wss' || lower === 'websocket')
    return { ok: false, error: WS_ERROR }
  return { ok: false, error: `Unknown type "${type}".` }
}

function readStringMap({
  value,
  label,
}: {
  value: unknown
  label: string
}): Fields<[string, string][]> {
  if (value === undefined) return { ok: true, value: [], refs: [] }
  if (!isRecord(value)) return { ok: false, error: `${label} must be an object.` }
  const pairs: [string, string][] = []
  const refs: string[] = []
  for (const [key, raw] of Object.entries(value)) {
    const text = scalarToString(raw)
    if (text === undefined) return { ok: false, error: `${label} values must be strings.` }
    if (hasInputRef(text)) return { ok: false, error: INPUT_ERROR }
    const rewritten = rewriteRefs(text)
    refs.push(...rewritten.refs)
    pairs.push([key, rewritten.value])
  }
  return { ok: true, value: pairs, refs }
}

function readArgs(value: unknown): Fields<string[]> {
  if (value === undefined) return { ok: true, value: [], refs: [] }
  if (!Array.isArray(value)) return { ok: false, error: 'args must be a list.' }
  const args: string[] = []
  const refs: string[] = []
  for (const raw of value) {
    const text = scalarToString(raw)
    if (text === undefined) return { ok: false, error: 'args must be strings.' }
    if (hasInputRef(text)) return { ok: false, error: INPUT_ERROR }
    const rewritten = rewriteRefs(text)
    refs.push(...rewritten.refs)
    args.push(rewritten.value)
  }
  return { ok: true, value: args, refs }
}

function secretsNote(refs: string[]): string[] {
  const unique = [...new Set(refs)]
  return unique.length === 0 ? [] : [`Uses secrets: ${unique.join(', ')}.`]
}

function buildLocal({ record, notes }: { record: JsonRecord; notes: string[] }): Converted {
  const command = readString(record, 'command')?.trim()
  if (!command) return { ok: false, error: 'Missing command.' }
  if (hasInputRef(command)) return { ok: false, error: INPUT_ERROR }
  const args = readArgs(record.args)
  if (!args.ok) return args
  const env = readStringMap({ value: record.env, label: 'env' })
  if (!env.ok) return env
  const commandRefs = rewriteRefs(command)
  const spec: McpLocalSpec = {
    transport: EMcpTransport.Stdio,
    command: commandRefs.value,
    args: args.value,
    env: env.value.map(([key, value]) => ({ key, value, secret: false })),
  }
  const refs = [...commandRefs.refs, ...args.refs, ...env.refs]
  return { ok: true, spec, notes: [...notes, ...secretsNote(refs)] }
}

function parseUrl(url: string): string | null {
  try {
    return new URL(url).protocol
  } catch {
    return null
  }
}

function splitBearer(pairs: [string, string][]): {
  token: string | null
  rest: [string, string][]
} {
  const found = pairs.find(
    ([key, value]) => key.toLowerCase() === 'authorization' && BEARER.test(value),
  )
  if (!found) return { token: null, rest: pairs }
  const token = BEARER.exec(found[1])?.[1] ?? null
  return { token, rest: pairs.filter((pair) => pair !== found) }
}

function buildRemote({ record, notes }: { record: JsonRecord; notes: string[] }): Converted {
  const rawUrl = readString(record, 'url')?.trim()
  if (!rawUrl) return { ok: false, error: 'Missing url.' }
  const protocol = parseUrl(rawUrl)
  if (protocol === 'ws:' || protocol === 'wss:') return { ok: false, error: WS_ERROR }
  if (protocol !== 'http:' && protocol !== 'https:') return { ok: false, error: 'Invalid url.' }
  const headers = readStringMap({ value: record.headers, label: 'headers' })
  if (!headers.ok) return headers
  const { token, rest } = splitBearer(headers.value)
  const entries: McpEntry[] = rest.map(([key, value]) => ({
    key,
    value,
    secret: hasRef(value) || SECRET_KEY.test(key),
  }))
  const auth: McpRemoteSpec['auth'] =
    token !== null
      ? { kind: EMcpAuth.Bearer, token }
      : entries.length === 0
        ? { kind: EMcpAuth.OAuth, clientId: '', clientSecret: '' }
        : { kind: EMcpAuth.None }
  const spec: McpRemoteSpec = { transport: EMcpTransport.Http, url: rawUrl, auth, headers: entries }
  return { ok: true, spec, notes: [...notes, ...secretsNote(headers.refs)] }
}

function convertSpec(raw: JsonRecord): Converted {
  const source = isRecord(raw.transport) ? raw.transport : raw
  const type = readString(source, 'kind') ?? readString(source, 'type')
  const kind = resolveKind({ type, record: source })
  if (!kind.ok) return kind
  return kind.transport === EMcpTransport.Stdio
    ? buildLocal({ record: source, notes: kind.notes })
    : buildRemote({ record: source, notes: kind.notes })
}

function convertEntry({ name, raw }: { name: string; raw: unknown }): McpImportEntry {
  if (name !== '' && !NAME.test(name)) {
    return {
      status: EMcpImportStatus.Error,
      name,
      error: 'Name can use letters, numbers, - and _.',
    }
  }
  if (!isRecord(raw)) return { status: EMcpImportStatus.Error, name, error: 'Expected an object.' }
  const converted = convertSpec(raw)
  if (!converted.ok) return { status: EMcpImportStatus.Error, name, error: converted.error }
  return {
    status: EMcpImportStatus.Ready,
    name,
    draft: { name, enabled: raw.disabled !== true, spec: converted.spec },
    notes: converted.notes,
  }
}

function looksLikeServer(record: JsonRecord): boolean {
  return (
    typeof record.command === 'string' ||
    typeof record.url === 'string' ||
    isRecord(record.transport)
  )
}

function wrappedMap(record: JsonRecord): JsonRecord | null {
  for (const key of ['mcpServers', 'servers']) {
    const value = record[key]
    if (isRecord(value) && !looksLikeServer(value)) return value
  }
  return null
}

function fromMap(map: JsonRecord): McpImportResult {
  const names = Object.keys(map)
  if (names.length === 0) return { kind: EMcpImportKind.Invalid, message: 'No servers found.' }
  const entries = names.map((name) => convertEntry({ name, raw: map[name] }))
  return { kind: EMcpImportKind.Servers, entries }
}

function fromSingle({ record, name }: { record: JsonRecord; name: string }): McpImportResult {
  const resolved = name.trim() || readString(record, 'name') || ''
  const entry = convertEntry({ name: resolved, raw: record })
  const needsName = resolved === '' && entry.status === EMcpImportStatus.Ready
  return {
    kind: needsName ? EMcpImportKind.NeedsName : EMcpImportKind.Servers,
    entries: [entry],
  }
}

export function parseMcpImport({
  text,
  name = '',
}: {
  text: string
  name?: string
}): McpImportResult {
  if (text.trim() === '') return { kind: EMcpImportKind.Empty }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { kind: EMcpImportKind.Invalid, message: 'Not valid JSON.' }
  }
  if (!isRecord(parsed)) return { kind: EMcpImportKind.Invalid, message: 'Expected a JSON object.' }
  const wrapped = wrappedMap(parsed)
  if (wrapped) return fromMap(wrapped)
  if (looksLikeServer(parsed)) return fromSingle({ record: parsed, name })
  if (Object.values(parsed).some(isRecord)) return fromMap(parsed)
  return { kind: EMcpImportKind.Invalid, message: 'No servers found.' }
}

export function readyDrafts(entries: McpImportEntry[]): McpDraft[] {
  return entries.flatMap((entry) => (entry.status === EMcpImportStatus.Ready ? [entry.draft] : []))
}
