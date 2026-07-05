import { useEffect, useState } from 'react';
import { wsClient, type WsStatus } from '@api/wsClient';

export const useWsStatus = (): WsStatus => {
  const [status, setStatus] = useState<WsStatus>(() => wsClient.getStatus());
  useEffect(() => wsClient.onStatus(setStatus), []);
  return status;
};
