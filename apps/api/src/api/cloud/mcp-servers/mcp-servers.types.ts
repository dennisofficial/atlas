import { EMcpTransportKind } from '@dltech/atlas-wire/web'

export { EMcpTransportKind }

export type McpTransportDraft = {
  kind: EMcpTransportKind
  command?: string | undefined
  args?: string[] | undefined
  env?: Record<string, string> | undefined
  url?: string | undefined
  headers?: Record<string, string> | undefined
}

export type McpSpecDraft = {
  transport?: McpTransportDraft | undefined
  disabled?: boolean | undefined
}

export type McpTransport =
  | {
      kind: EMcpTransportKind.Stdio
      command: string
      args?: string[]
      env?: Record<string, string>
    }
  | { kind: EMcpTransportKind.Http; url: string; headers?: Record<string, string> }

export interface McpSpec {
  name: string
  transport?: McpTransport
  disabled?: boolean
}

export interface McpServerDto extends McpSpec {
  updatedAt: string
}

export interface McpServerListDto {
  servers: McpServerDto[]
}
