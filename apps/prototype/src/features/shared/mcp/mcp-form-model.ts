import {
  EMcpAuth,
  EMcpTransport,
  type McpEntry,
  type McpServer,
} from '../../settings/fixtures/settings-mcp'
import type { McpDraft } from './mcp-import'

export type McpFormState = {
  name: string
  transport: EMcpTransport
  url: string
  authKind: EMcpAuth
  clientId: string
  clientSecret: string
  token: string
  headers: McpEntry[]
  command: string
  args: string[]
  env: McpEntry[]
}

const NAME = /^[a-zA-Z0-9_-]+$/

export function emptyForm(): McpFormState {
  return {
    name: '',
    transport: EMcpTransport.Http,
    url: '',
    authKind: EMcpAuth.OAuth,
    clientId: '',
    clientSecret: '',
    token: '',
    headers: [],
    command: '',
    args: [],
    env: [],
  }
}

export function formFromServer(server: McpServer | null): McpFormState {
  const base = emptyForm()
  if (!server) return base
  const { spec } = server
  if (spec.transport === EMcpTransport.Stdio) {
    return {
      ...base,
      name: server.name,
      transport: spec.transport,
      command: spec.command,
      args: spec.args,
      env: spec.env,
    }
  }
  return {
    ...base,
    name: server.name,
    transport: spec.transport,
    url: spec.url,
    authKind: spec.auth.kind,
    clientId: spec.auth.kind === EMcpAuth.OAuth ? spec.auth.clientId : '',
    clientSecret: spec.auth.kind === EMcpAuth.OAuth ? spec.auth.clientSecret : '',
    token: spec.auth.kind === EMcpAuth.Bearer ? spec.auth.token : '',
    headers: spec.headers,
  }
}

export function isNameValid(name: string): boolean {
  return NAME.test(name)
}

export function isHttpUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url.trim())
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

function cleanEntries(entries: McpEntry[]): McpEntry[] {
  return entries
    .filter((entry) => entry.key.trim() !== '')
    .map((entry) => ({ ...entry, key: entry.key.trim() }))
}

export function formToDraft(form: McpFormState): McpDraft | null {
  const name = form.name.trim()
  if (!isNameValid(name)) return null
  if (form.transport === EMcpTransport.Stdio) {
    const command = form.command.trim()
    if (command === '') return null
    return {
      name,
      enabled: true,
      spec: {
        transport: EMcpTransport.Stdio,
        command,
        args: form.args.map((arg) => arg.trim()).filter((arg) => arg !== ''),
        env: cleanEntries(form.env),
      },
    }
  }
  if (!isHttpUrl(form.url)) return null
  const headers = cleanEntries(form.headers)
  const url = form.url.trim()
  if (form.authKind === EMcpAuth.Bearer) {
    const token = form.token.trim()
    if (token === '') return null
    return {
      name,
      enabled: true,
      spec: { transport: EMcpTransport.Http, url, auth: { kind: EMcpAuth.Bearer, token }, headers },
    }
  }
  const auth =
    form.authKind === EMcpAuth.OAuth
      ? {
          kind: EMcpAuth.OAuth as const,
          clientId: form.clientId.trim(),
          clientSecret: form.clientSecret,
        }
      : { kind: EMcpAuth.None as const }
  return { name, enabled: true, spec: { transport: EMcpTransport.Http, url, auth, headers } }
}
