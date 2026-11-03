import { TelemetryPort } from './telemetry.port'

export class NullTelemetry extends TelemetryPort {
  turnCompleted(): void {}
  featureUsed(): void {}
  toolDenied(): void {}
  agentSpawned(): void {}
  agentEnded(): void {}
  exception(): void {}
  async flush(): Promise<void> {}
}
