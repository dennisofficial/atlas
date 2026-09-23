import { createCliRenderer, type CliRenderer } from "@opentui/core";
import { createRoot, type Root } from "@opentui/react";
import { writeFileSync } from "node:fs";
import React from "react";

import { buildInfo } from "../build/info";
import { appearanceOf, applyAppearance } from "../ui/appearance";
import { ENoticeTone, notify } from "../ui/notice-store";
import { installHeapDumpSignal } from "./heap-dump";
import { BOOT_FAILURE_EXIT_CODE, bootFailureReport } from "./boot-failure";
import { createBootProgress } from "./boot-progress";
import { BootScreen } from "./boot-screen";
import { CrashBoundary } from "./crash-boundary";
import { classifyRequestOf } from "./classify";
import { runClassify } from "./classify-run";
import { resolveConfig } from "./config";
import { ESession, openSession } from "./open-session";
import { performRespawn, realRespawnPorts, wiresSelfRestart } from "./respawn";
import { RESTART_EXIT_CODE, restartResumeHandle } from "./restart";
import { launchLine, launchTitle, sessionIdentityLine } from "./session-identity";
import { resumeHint, type ActiveConversation } from "@dltech/atlas-harness";
import { atlasDirectory, loadSettings } from "@dltech/atlas-harness";
import { exportLegacyDbRequestOf, runExportLegacyDb } from "./export-legacy-db";
import { trackTerminalFocus } from "./terminal-focus";
import { terminalTitleSequence } from "./terminal-title";
import { readTerminalSize, settleTerminalSize } from "./terminal-size";

const TARGET_FPS = 120;

const STILL_RUNNING = 0;

const ABANDONED = 130;

const takeDown = (args: { root: Root; renderer: CliRenderer }): void => {
  args.root.unmount();
  args.renderer.destroy();
};

/**
 * The renderer comes up before the harness does, so the curtain is what fills the terminal while
 * the database, the credentials and the grammars are still arriving. Settings are read off disk
 * ahead of it — every layer is synchronous — so the curtain is drawn in the operator's own palette
 * from its first frame rather than repainting out of the shipped one once the harness lands.
 */
export async function bootAtlas(args: {
  argv: readonly string[];
  env: Record<string, string | undefined>;
  cwd: string;
  command: string;
}): Promise<number> {
  const config = resolveConfig({
    argv: args.argv,
    cwd: args.cwd,
    home: args.env.HOME,
  });

  const classify = classifyRequestOf({ argv: args.argv });
  if (classify !== undefined) {
    return await runClassify({ request: classify, cwd: config.cwd, env: args.env });
  }

  const exportLegacyDb = exportLegacyDbRequestOf({
    argv: args.argv,
    home: atlasDirectory(),
  });
  if (exportLegacyDb !== undefined) {
    return await runExportLegacyDb({ request: exportLegacyDb });
  }

  process.stdout.write(
    launchLine({
      open: config.open,
      directory: config.cwd,
      home: args.env.HOME,
      pid: process.pid,
      at: new Date(),
    }),
  );

  const settings = loadSettings({ env: args.env, cwd: config.cwd });
  applyAppearance(appearanceOf({ resolution: settings.service.snapshot().resolution }));

  const progress = createBootProgress();
  const session = openSession({
    config,
    command: args.command,
    env: args.env,
    progress,
    settings,
  });

  const renderer = await createCliRenderer({
    useMouse: true,
    exitOnCtrlC: false,
    targetFps: TARGET_FPS,
  });

  const untrackFocus = trackTerminalFocus({
    source: renderer,
    write: (sequence) => process.stdout.write(sequence),
  });
  renderer.once("destroy", untrackFocus);

  process.stdout.write(
    terminalTitleSequence({ name: launchTitle(config.open), directory: config.cwd }),
  );

  const stopSettling = settleTerminalSize({
    read: () => readTerminalSize(process.stdout),
    current: () => ({
      width: renderer.terminalWidth,
      height: renderer.terminalHeight,
    }),
    apply: (size) => renderer.resize(size.width, size.height),
    schedule: (run, delayMs) => {
      const timer = setTimeout(run, delayMs);
      return () => clearTimeout(timer);
    },
  });

  renderer.once("destroy", stopSettling);

  const restartFile = args.env.ATLAS_DEV_RESTART_FILE;
  const selfRestart = restartFile === undefined && wiresSelfRestart(buildInfo().kind);
  let restartRequested = false;

  let activeThread: () => ActiveConversation | null = () => null;

  const identity = (): string =>
    sessionIdentityLine({
      active: activeThread(),
      directory: config.cwd,
      home: args.env.HOME,
      pid: process.pid,
    });

  const root = createRoot(renderer);
  root.render(
    <CrashBoundary identity={identity}>
      <BootScreen
        session={session}
        progress={progress}
        cwd={config.cwd}
        onAbandon={() => {
          takeDown({ root, renderer });
          process.exit(ABANDONED);
        }}
        {...(restartFile === undefined && !selfRestart
          ? {}
          : {
              onRestart: () => {
                restartRequested = true;
                renderer.destroy();
              },
            })}
      />
    </CrashBoundary>,
  );

  const settled = await session;

  if (settled.type === ESession.Ready) {
    activeThread = () => settled.app.activeThread();
    installHeapDumpSignal({
      onDone: ({ text, failed }) =>
        notify({ text, tone: failed ? ENoticeTone.Warn : ENoticeTone.Done }),
    });
  }

  if (settled.type === ESession.Failed) {
    takeDown({ root, renderer });
    process.stderr.write(
      bootFailureReport({
        error: settled.error,
        debug: args.env.ATLAS_DEBUG !== undefined,
      }),
    );
    return BOOT_FAILURE_EXIT_CODE;
  }

  if (settled.type === ESession.Refused) {
    takeDown({ root, renderer });
    process.stderr.write(`${settled.message}\n`);
    return settled.exitCode;
  }

  renderer.on("destroy", () => {
    const active = settled.app.activeThread();

    void settled.app.close().finally(() => {
      if (restartRequested && restartFile !== undefined) {
        writeFileSync(restartFile, restartResumeHandle({ active }) ?? "");
        process.exit(RESTART_EXIT_CODE);
      }

      if (restartRequested && selfRestart) {
        performRespawn({
          execPath: process.execPath,
          cwd: config.cwd,
          resumeHandle: restartResumeHandle({ active }),
          ports: realRespawnPorts(process.execPath),
        });
        return;
      }

      const hint = resumeHint({ active, command: args.command });
      if (hint !== null) process.stdout.write(hint);
      process.exit(0);
    });
  });

  return STILL_RUNNING;
}
