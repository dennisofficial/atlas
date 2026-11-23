export type Agent37Status =
  | 'provisioning'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'updating'
  | 'sleeping'
  | 'waking'
  | 'restarting'
  | 'stopped'
  | 'failed'
  | 'deleting'
  | 'deleted'

export type Agent37Instance = {
  id: string
  status: Agent37Status
  url: string
  name?: string | undefined
  metadata?: Record<string, string> | undefined
  /** Creation time in epoch seconds. */
  created?: number | undefined
  resources?: Agent37Resources | undefined
}

export type Agent37Resources = { cpu: number; memory: number; disk: number }

// https://www.agent37.com/docs/agents-api/logs.md — null until the instance has ever booted.
export type Agent37Health = {
  running: boolean
  restart_count: number
  exit_code: number | null
  oom_suspected: boolean
}

export type Agent37Logs = {
  logs: string
  truncated: boolean
  health: Agent37Health | null
  fetched_at: number
}

export type Agent37CreateArgs = {
  template: string
  type: 'vm'
  region: 'us'
  name: string
  metadata: Record<string, string>
  resources: Agent37Resources
  mount_path: string
  auto_sleep: boolean
  idle_timeout_seconds: number
  env: Record<string, string>
}

export type Agent37ResizeArgs = {
  id: string
  cpu?: number | undefined
  memory?: number | undefined
  disk?: number | undefined
}

export type Agent37ExecResult = {
  exit_code: number
  stdout: string
  stderr: string
  truncated: boolean
}

export type Agent37Pid = { pid: number }

export type Agent37Answer = {
  status: number
  body: string
  headers?: Record<string, string> | undefined
}

export type Agent37ExecArgs = {
  id: string
  command: string
  background?: boolean
  name?: string
  user?: 'root'
}
