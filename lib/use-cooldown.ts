import { useState, useEffect, useCallback } from "react";

export function useCooldown(durationSeconds: number) {
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    if (remaining > 0) {
      const timer = setInterval(() => {
        setRemaining((r) => r - 1);
      }, 1000);
      return () => clearInterval(timer);
    }
  }, [remaining]);

  const start = useCallback(() => {
    setRemaining(durationSeconds);
  }, [durationSeconds]);

  return {
    active: remaining > 0,
    remaining,
    start,
  };
}
