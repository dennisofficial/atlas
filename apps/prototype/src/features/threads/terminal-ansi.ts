import { ETerminalEntry, SANDBOX, type TerminalEntry, type UserTerminal } from './sandbox-terminal'

const ESC = '\u001b'
const RESET = `${ESC}[0m`
const GREEN = `${ESC}[32m`
const BLUE = `${ESC}[34m`
const YELLOW = `${ESC}[33m`
const GREY = `${ESC}[90m`

interface PromptInput {
  cwd: string
  host?: string
}

export function promptOf({ cwd, host = SANDBOX.host }: PromptInput): string {
  return `${GREEN}${SANDBOX.user}@${host}${RESET} ${BLUE}${cwd}${RESET} ${YELLOW}(${SANDBOX.branch})${RESET} ${GREY}$${RESET} `
}

function toCrlf(text: string): string {
  return text.replace(/\r?\n/g, '\r\n')
}

function entryAnsi({ entry, host }: { entry: TerminalEntry; host?: string }): string {
  if (entry.kind === ETerminalEntry.Output) return `${toCrlf(entry.text)}\r\n`
  return `${promptOf({ cwd: entry.cwd, host })}${entry.command}\r\n`
}

export function scrollbackOf(terminal: UserTerminal): string {
  return terminal.entries.map((entry) => entryAnsi({ entry, host: terminal.host })).join('')
}

export function nextInputOf({ buffer, data }: { buffer: string; data: string }) {
  if (data === '\r') return { buffer: '', echo: '\r\n', command: buffer.trim() }
  if (data === '\u007f') {
    return buffer ? { buffer: buffer.slice(0, -1), echo: '\b \b' } : { buffer, echo: '' }
  }
  if (data < ' ' || data.startsWith(ESC)) return { buffer, echo: '' }
  return { buffer: buffer + data, echo: data }
}
