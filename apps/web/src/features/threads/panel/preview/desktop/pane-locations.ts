const locations = new Map<string, string>()

export const notePaneLocation = (args: { id: string; url: string }): void => {
  locations.set(args.id, args.url)
}

export const paneLocationOf = (id: string): string | undefined => locations.get(id)
