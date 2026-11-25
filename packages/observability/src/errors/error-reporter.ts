export type ErrorReportProperties = Record<string, string | number | boolean>

export abstract class ErrorReporter {
  abstract report(args: { error: Error; properties: ErrorReportProperties }): void
}

export class NullErrorReporter extends ErrorReporter {
  report(): void {}
}
