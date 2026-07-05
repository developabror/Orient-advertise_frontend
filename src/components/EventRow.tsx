import { ExpandableText } from './ExpandableText';
import { TimeAgo } from './TimeAgo';
import type { DeviceEvent, DeviceEventType, EventPriority } from '@hooks/useDeviceEvents';

// Fallback when the event payload doesn't carry an explicit priority. Tuned
// so the dot color carries some signal even on legacy events.
const TYPE_DEFAULT_PRIORITY: Record<DeviceEventType, EventPriority> = {
  INCIDENT: 'critical',
  STATUS_CHANGE: 'high',
  COMMAND: 'medium',
  CONTENT_SYNC: 'low',
  BOOT: 'low',
};

interface Props {
  event: DeviceEvent;
}

export const EventRow = ({ event }: Props) => {
  const priority = event.priority ?? TYPE_DEFAULT_PRIORITY[event.type];
  const hasMessage = event.message !== '';
  const metadata = event.metadata !== undefined && event.metadata !== '' ? event.metadata : null;

  return (
    <li className="oa-event-row" data-priority={priority}>
      <span className="oa-event-row__dot" aria-label={`${priority} priority`} />
      <div className="oa-event-row__body">
        <div className="oa-event-row__head">
          <span className="oa-event-row__type">{event.type.replace(/_/g, ' ')}</span>
          <TimeAgo date={event.occurredAt} className="oa-event-row__time" />
        </div>
        {hasMessage && <p className="oa-event-row__message">{event.message}</p>}
        {metadata !== null && (
          <p className="oa-event-row__metadata">
            <ExpandableText text={metadata} max={100} />
          </p>
        )}
      </div>
    </li>
  );
};
