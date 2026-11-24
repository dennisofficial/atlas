import { File } from 'expo-file-system'

export const readBytes = async (args: { uri: string; blob?: Blob | undefined }) =>
  new Uint8Array(await new File(args.uri).arrayBuffer())
