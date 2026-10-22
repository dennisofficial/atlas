export type RevealGate = { key: string; revealed: number }

export function revealedText(args: { key: string; text: string; gate: RevealGate | null }): string {
  if (args.gate === null || args.gate.key !== args.key) return args.text
  return args.text.slice(0, args.gate.revealed)
}
