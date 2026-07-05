import { useEffect, useRef } from 'react';
import { wsClient, type WsEvent, type WsEventType } from '@api/wsClient';

export const useWsEvent = <T extends WsEventType>(
  type: T,
  handler: (event: Extract<WsEvent, { type: T }>) => void,
): void => {
  const ref = useRef(handler);
  // Keep ref current without re-subscribing on every render.
  useEffect(() => {
    ref.current = handler;
  });

  useEffect(() => {
    return wsClient.onEvent(type, (event) => {
      ref.current(event);
    });
  }, [type]);
};
