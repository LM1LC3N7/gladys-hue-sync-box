// -----------------------------------------------------------------------------
// Manual timers and clock for the poll loops: nothing runs until the test
// advances the clock, then the due callbacks run in order, awaited.
// -----------------------------------------------------------------------------

/** Lets the fire-and-forget promises (publish calls) settle. */
export const settle = () => new Promise((resolve) => setImmediate(resolve));

export function fakeTimers(start = 1_000_000) {
  let now = start;
  let seq = 0;
  const tasks = new Map();
  return {
    now: () => now,
    setTimeout(fn, ms = 0) {
      seq += 1;
      tasks.set(seq, { fn, at: now + Math.max(0, ms) });
      return seq;
    },
    clearTimeout(id) {
      tasks.delete(id);
    },
    pending: () => [...tasks.values()].map((t) => t.at - now),
    /** Runs every callback due within `ms`, in time order, then settles. */
    async advance(ms = 0) {
      const end = now + ms;
      for (;;) {
        const due = [...tasks.entries()]
          .filter(([, t]) => t.at <= end)
          .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
        if (!due) break;
        tasks.delete(due[0]);
        now = due[1].at;
        await due[1].fn();
        await settle();
      }
      now = end;
      await settle();
    },
    /** A sleep that only moves the clock (the registration pace). */
    sleep: async (ms) => {
      now += ms;
    },
  };
}
