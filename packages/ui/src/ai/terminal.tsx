import { TerminalIcon } from "lucide-react";

import { CodeBlock, CodeBlockContent } from "#components/code-block";
import { Trace } from "#components/trace";
import { Step } from "./internal/step";

export interface TerminalProps {
  command: string;
  output?: string;
  running?: boolean;
  exitCode?: number;
  elapsed?: string;
  defaultOpen?: boolean;
}

interface TitleInput {
  command: string;
  running: boolean;
  exitCode: number | undefined;
}

export function terminalTitle({ command, running, exitCode }: TitleInput): string {
  if (running) return `Running ${command}`;
  if (exitCode !== undefined && exitCode !== 0) {
    return `${command} exited with code ${exitCode}`;
  }
  return `Ran ${command}`;
}

export function Terminal({
  command,
  output = "",
  running = false,
  exitCode,
  elapsed,
  defaultOpen,
}: TerminalProps) {
  const failed = !running && exitCode !== undefined && exitCode !== 0;
  const hasOutput = output.length > 0;

  return (
    <Trace>
      <Step
        icon={<TerminalIcon />}
        title={terminalTitle({ command, running, exitCode })}
        description={elapsed}
        status={running ? "running" : failed ? "error" : undefined}
        autoOpen={defaultOpen === undefined ? running && hasOutput : undefined}
        defaultOpen={defaultOpen}
      >
        {hasOutput ? (
          <CodeBlock size="sm">
            <CodeBlockContent wrap className="max-h-64">
              {output}
            </CodeBlockContent>
          </CodeBlock>
        ) : undefined}
      </Step>
    </Trace>
  );
}
