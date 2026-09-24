const COMMAND_HEAD = '(?:^|[;&|\\n(])\\s*'
const FOLLOW_FLAG = '(?:-[a-zA-Z]*[fF][a-zA-Z]*(?=\\s|$)|--follow\\b)'
const BEFORE_PIPE = '[^|;&\\n]*'

const atCommandHead = (body: string): RegExp => new RegExp(`${COMMAND_HEAD}${body}`)

const GH_RUN_WATCH = atCommandHead('gh\\s+run\\s+watch\\b')
const GH_PR_CHECKS_WATCH = atCommandHead(`gh\\s+pr\\s+checks\\b${BEFORE_PIPE}\\s--watch\\b`)
const TAIL_FOLLOW = atCommandHead(`tail\\b${BEFORE_PIPE}${FOLLOW_FLAG}`)
const DOCKER_LOGS_FOLLOW = atCommandHead(`docker\\s+(?:container\\s+)?logs\\b${BEFORE_PIPE}${FOLLOW_FLAG}`)
const KUBECTL_LOGS_FOLLOW = atCommandHead(`kubectl\\s+logs\\b${BEFORE_PIPE}${FOLLOW_FLAG}`)
const KUBECTL_WAIT = atCommandHead('kubectl\\s+wait\\b')
const JOURNALCTL_FOLLOW = atCommandHead(`journalctl\\b${BEFORE_PIPE}${FOLLOW_FLAG}`)

const FOREGROUND_WATCHES: readonly RegExp[] = [
  GH_RUN_WATCH,
  GH_PR_CHECKS_WATCH,
  TAIL_FOLLOW,
  DOCKER_LOGS_FOLLOW,
  KUBECTL_LOGS_FOLLOW,
  KUBECTL_WAIT,
  JOURNALCTL_FOLLOW,
]

export function waitsByWatching({ command }: { command: string }): boolean {
  return FOREGROUND_WATCHES.some((pattern) => pattern.test(command))
}

const CI_WATCH = new RegExp(`(?:${GH_RUN_WATCH.source}|${GH_PR_CHECKS_WATCH.source})`)
const TRUNCATOR = /\|\s*(?:tail|head)\b/

export function truncatesWatch({ command }: { command: string }): boolean {
  return CI_WATCH.test(command) && TRUNCATOR.test(command)
}
