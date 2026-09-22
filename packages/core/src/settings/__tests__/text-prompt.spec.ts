import { describe, expect, it } from 'bun:test'

import {
  backspaceTextPrompt,
  commitTextPrompt,
  ETextCommit,
  openTextPrompt,
  typeIntoTextPrompt,
} from '../text-prompt'

const opened = () =>
  openTextPrompt({ id: 'sandbox.vercelTeamId', label: 'Vercel team', current: 'team_123' })

describe('the text setting prompt', () => {
  it('opens holding the current value so it can be edited rather than retyped', () => {
    expect(opened().typed).toBe('team_123')
  })

  it('appends typed text and takes it back on backspace', () => {
    const typed = typeIntoTextPrompt({ prompt: opened(), text: 'x' })
    expect(typed.typed).toBe('team_123x')
    expect(backspaceTextPrompt(typed).typed).toBe('team_123')
  })

  it('saves the trimmed value on commit', () => {
    const typed = typeIntoTextPrompt({ prompt: opened(), text: '456\n' })
    expect(commitTextPrompt(typed)).toEqual({
      action: ETextCommit.Save,
      id: 'sandbox.vercelTeamId',
      value: 'team_123456',
    })
  })

  it('clears the setting when the value is emptied out', () => {
    let prompt = opened()
    for (const _ of prompt.typed) prompt = backspaceTextPrompt(prompt)
    expect(commitTextPrompt(prompt)).toEqual({
      action: ETextCommit.Clear,
      id: 'sandbox.vercelTeamId',
    })
  })

  it('clears rather than saving a whitespace-only value', () => {
    let prompt = opened()
    for (const _ of prompt.typed) prompt = backspaceTextPrompt(prompt)
    prompt = typeIntoTextPrompt({ prompt, text: '   ' })
    expect(commitTextPrompt(prompt).action).toBe(ETextCommit.Clear)
  })
})
