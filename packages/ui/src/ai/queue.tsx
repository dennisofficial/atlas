import { CircleCheckIcon, CircleIcon, ListChecksIcon, ListTodoIcon } from "lucide-react";

import { Trace } from "#components/trace";
import { Step, StepLine } from "./internal/step";

export interface QueueTodo {
  id: string;
  title: string;
  description?: string;
  done: boolean;
}

export interface QueueProps {
  todos: QueueTodo[];
}

export function splitTodos(todos: QueueTodo[]) {
  return {
    pending: todos.filter((todo) => !todo.done),
    completed: todos.filter((todo) => todo.done),
  };
}

function TodoRow({ todo }: { todo: QueueTodo }) {
  return (
    <Step
      icon={todo.done ? <CircleCheckIcon /> : <CircleIcon />}
      title={todo.title}
    >
      {todo.description}
    </Step>
  );
}

interface SectionProps {
  icon: React.ReactNode;
  title: string;
  todos: QueueTodo[];
  defaultOpen?: boolean;
}

function Section({ icon, title, todos, defaultOpen }: SectionProps) {
  if (todos.length === 0) return <StepLine icon={icon} title={title} />;
  return (
    <Step icon={icon} title={title} defaultOpen={defaultOpen} keepMounted>
      <Trace>
        {todos.map((todo) => (
          <TodoRow key={todo.id} todo={todo} />
        ))}
      </Trace>
    </Step>
  );
}

export function Queue({ todos }: QueueProps) {
  const { pending, completed } = splitTodos(todos);

  return (
    <Trace>
      <Section
        icon={<ListTodoIcon />}
        title={`${pending.length} to do`}
        todos={pending}
        defaultOpen
      />
      <Section
        icon={<ListChecksIcon />}
        title={`${completed.length} completed`}
        todos={completed}
      />
    </Trace>
  );
}
