const sent = new Set<string>()

export const rememberSentClientId = (clientId: string): void => {
  sent.add(clientId)
}

export const sentClientIds = (): readonly string[] => [...sent]
