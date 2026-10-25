// Sample mode is per request, not per process: a visitor asking for a sample run
// must not flip a live server (or another visitor's live run) into replay.

import { AsyncLocalStorage } from "node:async_hooks";

export const modeScope = new AsyncLocalStorage<{ sample: boolean }>();

/** True inside a sample-mode request, or process-wide when SAMPLE_MODE=true (CLI, Docker without keys). */
export const isSample = (): boolean => modeScope.getStore()?.sample ?? process.env.SAMPLE_MODE === "true";
