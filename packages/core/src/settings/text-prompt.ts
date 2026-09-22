export type TextPrompt = {
  id: string
  label: string
  typed: string
}

export enum ETextCommit {
  Save = 'save',
  Clear = 'clear',
}

export type TextCommit =
  | { action: ETextCommit.Save; id: string; value: string }
  | { action: ETextCommit.Clear; id: string }

export const openTextPrompt = (args: {
  id: string
  label: string
  current: string
}): TextPrompt => ({ id: args.id, label: args.label, typed: args.current })

export const typeIntoTextPrompt = (args: {
  prompt: TextPrompt
  text: string
}): TextPrompt => ({ ...args.prompt, typed: `${args.prompt.typed}${args.text}` })

export const backspaceTextPrompt = (prompt: TextPrompt): TextPrompt => ({
  ...prompt,
  typed: [...prompt.typed].slice(0, -1).join(''),
})

export function commitTextPrompt(prompt: TextPrompt): TextCommit {
  const value = prompt.typed.trim()
  if (value.length === 0) return { action: ETextCommit.Clear, id: prompt.id }
  return { action: ETextCommit.Save, id: prompt.id, value }
}
