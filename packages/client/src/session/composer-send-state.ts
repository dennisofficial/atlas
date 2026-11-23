export type ComposerSendState = {
  canSend: boolean
  showsStop: boolean
}

export const composerSendStateOf = (args: {
  text: string
  attached: boolean
  working: boolean
  sending: boolean
}): ComposerSendState => {
  const hasDraft = args.attached || args.text.trim().length > 0
  return {
    canSend: !args.sending && hasDraft,
    showsStop: args.working && !args.sending && !hasDraft,
  }
}
