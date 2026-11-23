export const triggerSdkStub = {
  schemaTask: <T>(definition: T): T => definition,
  schedules: { task: <T>(definition: T): T => definition },
  logger: { log: () => undefined, warn: () => undefined, error: () => undefined },
  wait: { for: async () => undefined },
  TriggerClient: class {
    readonly tasks = { trigger: async () => ({ id: 'run_stub' }) }
  },
}
