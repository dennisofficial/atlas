import { describe, expect, it } from 'bun:test'

import { EPodPhase, terminalConnectionOf } from "../pod-state";
import { canResize, chipLabel, EPodState, ramOf, RUNNING_POD, sizeLabel, VCPU_STEPS } from "../pod-status";
import { ETerminalConnection } from "../sandbox-terminal";

describe("pod size", () => {
  it("links RAM at 2 GB per vCPU across the 2/4/8 steps", () => {
    expect(VCPU_STEPS).toEqual([2, 4, 8]);
    expect(VCPU_STEPS.map(ramOf)).toEqual([4, 8, 16]);
    expect(sizeLabel(4)).toBe("4 vCPU · 8 GB");
  });
});

describe("chipLabel", () => {
  it("shows only the size while the pod runs, leaving the state to the dot", () => {
    expect(chipLabel(RUNNING_POD)).toBe("4 vCPU · 8 GB");
  });

  it("names the state beside the size while resuming", () => {
    expect(chipLabel({ ...RUNNING_POD, state: EPodState.Resuming })).toBe("Resuming · 4 vCPU · 8 GB");
  });

  it("shows only the state when parked or starting", () => {
    expect(chipLabel({ ...RUNNING_POD, state: EPodState.Parked })).toBe("Parked");
    expect(chipLabel({ ...RUNNING_POD, state: EPodState.Starting })).toBe("Starting");
  });
});

describe("canResize", () => {
  it("allows resize for running, resuming and parked pods only", () => {
    expect(canResize(EPodState.Running)).toBe(true);
    expect(canResize(EPodState.Parked)).toBe(true);
    expect(canResize(EPodState.Starting)).toBe(false);
    expect(canResize(EPodState.Stopped)).toBe(false);
  });
});

describe("terminalConnectionOf", () => {
  it("connects while starting, connects when ready and disconnects on failure", () => {
    expect(terminalConnectionOf(EPodPhase.Starting)).toBe(ETerminalConnection.Connecting);
    expect(terminalConnectionOf(EPodPhase.Ready)).toBe(ETerminalConnection.Connected);
    expect(terminalConnectionOf(EPodPhase.Failed)).toBe(ETerminalConnection.Disconnected);
    expect(terminalConnectionOf(EPodPhase.None)).toBeUndefined();
  });
});
