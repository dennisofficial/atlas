export enum EMcpTransportKind {
  Stdio = 'stdio',
  Http = 'http',
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
  trusted?: boolean
}

export interface McpServerDto extends McpSpec {
  updatedAt: string
}

export interface McpServerListDto {
  servers: McpServerDto[]
}
