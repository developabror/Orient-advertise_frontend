export type AuthBroadcast =
  | { readonly type: 'token'; readonly accessToken: string }
  | { readonly type: 'logout' };

const CHANNEL_NAME = 'oa.auth';

let channel: BroadcastChannel | null = null;

const getChannel = (): BroadcastChannel => {
  channel ??= new BroadcastChannel(CHANNEL_NAME);
  return channel;
};

const parseBroadcast = (value: unknown): AuthBroadcast | null => {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  if (v.type === 'logout') return { type: 'logout' };
  if (v.type === 'token' && typeof v.accessToken === 'string') {
    return { type: 'token', accessToken: v.accessToken };
  }
  return null;
};

export const broadcast = (msg: AuthBroadcast): void => {
  getChannel().postMessage(msg);
};

export const onBroadcast = (handler: (msg: AuthBroadcast) => void): (() => void) => {
  const ch = getChannel();
  const listener = (event: MessageEvent<unknown>): void => {
    const data = parseBroadcast(event.data);
    if (data) handler(data);
  };
  ch.addEventListener('message', listener);
  return () => {
    ch.removeEventListener('message', listener);
  };
};
