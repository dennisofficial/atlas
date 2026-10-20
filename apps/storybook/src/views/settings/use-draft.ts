import { useState } from "react";

export type Draft<T> = {
  value: T;
  setValue: (next: T) => void;
  dirty: boolean;
  discard: () => void;
  save: () => void;
};

export function useDraft<T>(initial: T): Draft<T> {
  const [saved, setSaved] = useState(initial);
  const [value, setValue] = useState(initial);
  const dirty = JSON.stringify(saved) !== JSON.stringify(value);
  return {
    value,
    setValue,
    dirty,
    discard: () => setValue(saved),
    save: () => setSaved(value),
  };
}
