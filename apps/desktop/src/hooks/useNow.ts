import { useEffect, useState } from "react";

/**
 * The current time in milliseconds, refreshed every `intervalMs` while
 * `active` — for elapsed-time displays, which cannot read the clock during
 * render.
 */
export function useNow(intervalMs: number, active: boolean): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [active, intervalMs]);

  return now;
}
