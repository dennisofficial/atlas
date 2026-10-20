import {
  CheckIcon,
  CircleDashedIcon,
  FileCodeIcon,
  FlaskConicalIcon,
  XIcon,
} from "lucide-react";

import { CodeBlock, CodeBlockContent } from "#components/code-block";
import { Trace } from "#components/trace";
import { Step } from "./internal/step";

export enum ETestStatus {
  Passed = "passed",
  Failed = "failed",
  Skipped = "skipped",
}

export interface TestCase {
  name: string;
  status: ETestStatus;
  error?: string;
}

export interface TestSuite {
  name: string;
  tests: TestCase[];
}

export interface TestResultsProps {
  suites: TestSuite[];
  defaultOpen?: boolean;
}

export interface TestCounts {
  total: number;
  failed: number;
  skipped: number;
}

export function countTests(tests: TestCase[]): TestCounts {
  return {
    total: tests.length,
    failed: tests.filter((test) => test.status === ETestStatus.Failed).length,
    skipped: tests.filter((test) => test.status === ETestStatus.Skipped).length,
  };
}

export function formatCounts({ total, failed, skipped }: TestCounts): string {
  return [
    `${total} ${total === 1 ? "test" : "tests"}`,
    failed > 0 ? `${failed} failed` : null,
    skipped > 0 ? `${skipped} skipped` : null,
  ]
    .filter(Boolean)
    .join(", ");
}

function TestRow({ test }: { test: TestCase }) {
  if (test.status === ETestStatus.Failed) {
    return (
      <Step icon={<XIcon />} title={test.name} status="error">
        {test.error ? (
          <CodeBlock size="sm">
            <CodeBlockContent wrap className="max-h-64">
              {test.error}
            </CodeBlockContent>
          </CodeBlock>
        ) : undefined}
      </Step>
    );
  }

  const skipped = test.status === ETestStatus.Skipped;
  return (
    <Step
      icon={skipped ? <CircleDashedIcon /> : <CheckIcon />}
      title={skipped ? `Skipped ${test.name}` : test.name}
    />
  );
}

export function TestResults({ suites, defaultOpen = true }: TestResultsProps) {
  const summary = countTests(suites.flatMap((suite) => suite.tests));

  return (
    <Trace>
      <Step
        icon={<FlaskConicalIcon />}
        title={`Ran ${formatCounts(summary)}`}
        status={summary.failed > 0 ? "error" : undefined}
        defaultOpen={defaultOpen}
        keepMounted
      >
        <Trace>
          {suites.map((suite) => {
            const counts = countTests(suite.tests);
            return (
              <Step
                key={suite.name}
                icon={<FileCodeIcon />}
                title={`${suite.name}, ${formatCounts(counts)}`}
                status={counts.failed > 0 ? "error" : undefined}
                defaultOpen={counts.failed > 0}
                keepMounted
              >
                <Trace>
                  {suite.tests.map((test) => (
                    <TestRow key={test.name} test={test} />
                  ))}
                </Trace>
              </Step>
            );
          })}
        </Trace>
      </Step>
    </Trace>
  );
}
