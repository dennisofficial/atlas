export abstract class OnceLedger {
  abstract once<T>(args: { key: string; decide: () => Promise<T> }): Promise<T>
  abstract recall(args: { prefix: string }): Promise<readonly { key: string; value: unknown }[]>
}
