import { useEffect, useState } from 'react';

// Returns `true` only after `active` has been continuously true for
// `delayMs`. Used to defer skeleton loaders so quick fetches never flash a
// skeleton on screen.
export const useDelayedFlag = (active: boolean, delayMs: number): boolean => {
  const [flag, setFlag] = useState(false);

  useEffect(() => {
    if (!active) {
      setFlag(false);
      return;
    }
    const timer = window.setTimeout(() => {
      setFlag(true);
    }, delayMs);
    return () => {
      window.clearTimeout(timer);
    };
  }, [active, delayMs]);

  return flag;
};
