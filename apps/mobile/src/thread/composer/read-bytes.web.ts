export const readBytes = async (args: { uri: string; blob?: Blob | undefined }) => {
  const blob = args.blob ?? (await (await fetch(args.uri)).blob())
  return new Uint8Array(await blob.arrayBuffer())
}
