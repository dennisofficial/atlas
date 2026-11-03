export abstract class OnceLedger {
  abstract once<T>(args: { key: string; decide: () => Promise<T> }): Promise<T>
}
