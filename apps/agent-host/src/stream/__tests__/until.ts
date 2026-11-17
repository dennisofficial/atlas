export const until = async (condition: () => boolean, label: string): Promise<void> => {
  const deadline = Date.now() + 2_000
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`)
    await Bun.sleep(2)
  }
}
