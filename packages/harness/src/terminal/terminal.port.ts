export type TerminalEvent =
  | { type: 'output'; terminalId: string; data: string }
  | { type: 'exit'; terminalId: string; exitCode: number | null; signal: string | null }

export type TerminalListener = (event: TerminalEvent) => void

export abstract class TerminalPort {
  abstract open(args: { cols: number; rows: number }): Promise<{ terminalId: string }>
  abstract write(args: { terminalId: string; data: string }): Promise<boolean>
  abstract resize(args: { terminalId: string; cols: number; rows: number }): Promise<boolean>
  abstract close(args: { terminalId: string }): Promise<boolean>
  abstract subscribe(listener: TerminalListener): () => void
}
