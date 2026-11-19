export abstract class PodPlanGate {
  abstract assertWithinPlan(args: { userId: string; vcpus: number }): Promise<void>
}
