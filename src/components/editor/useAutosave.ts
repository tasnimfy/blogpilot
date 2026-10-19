"use client";

// Autosave state machine for the editor. Debounces writes after the last
// edit, surfaces visible saving/saved/error states, and retains the last
// failed payload so the user can retry without losing a word.

import { useCallback, useRef, useState } from "react";
import { debounce } from "@/lib/debounce";

export type AutosaveState = "idle" | "saving" | "saved" | "error";

export interface UseAutosaveResult<D> {
  state: AutosaveState;
  failed: D | null;
  schedule: (data: D) => void;
  retry: () => void;
}

export function useAutosave<D>(opts: { delayMs: number; onSave: (data: D) => Promise<void> }): UseAutosaveResult<D> {
  const { delayMs, onSave } = opts;
  const [state, setState] = useState<AutosaveState>("idle");
  const [failed, setFailed] = useState<D | null>(null);

  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  const stateRef = useRef(state);
  stateRef.current = state;
  const failedRef = useRef<D | null>(failed);
  failedRef.current = failed;

  const bouncerRef = useRef<ReturnType<typeof debounce<[D]>> | null>(null);
  if (!bouncerRef.current) {
    bouncerRef.current = debounce<[D]>(async (data: D) => {
      setState("saving");
      try {
        await onSaveRef.current(data);
        setFailed(null);
        setState("saved");
      } catch {
        setFailed(data);
        setState("error");
      }
    }, delayMs);
  }
  const bouncer = bouncerRef.current;

  const schedule = useCallback(
    (data: D) => {
      setFailed(null);
      bouncer.run(data);
    },
    [bouncer]
  );

  const retry = useCallback(() => {
    if (failedRef.current !== null) {
      setFailed(null);
      bouncer.run(failedRef.current);
    }
  }, [bouncer]);

  return { state, failed, schedule, retry };
}