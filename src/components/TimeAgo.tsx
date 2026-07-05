import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

interface TimeAgoProps {
  date: string | Date;
  className?: string;
}

const formatTimeAgo = (date: Date, t: TFunction): string => {
  const diff = Date.now() - date.getTime();
  if (diff < 0) return t('timeAgo.future');
  const seconds = Math.floor(diff / 1000);
  if (seconds < 5) return t('timeAgo.justNow');
  if (seconds < 60) return t('timeAgo.secondsAgo', { count: seconds });
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return t('timeAgo.minutesAgo', { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('timeAgo.hoursAgo', { count: hours });
  const days = Math.floor(hours / 24);
  if (days < 7) return t('timeAgo.daysAgo', { count: days });
  return date.toLocaleDateString();
};

const TICK_INTERVAL_MS = 15_000;

export const TimeAgo = ({ date, className }: TimeAgoProps) => {
  const { t } = useTranslation();
  const d = typeof date === 'string' ? new Date(date) : date;
  const [, setTick] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => {
      setTick((n) => n + 1);
    }, TICK_INTERVAL_MS);
    return () => {
      window.clearInterval(id);
    };
  }, []);

  if (Number.isNaN(d.getTime())) {
    return (
      <time className={className} title={t('timeAgo.unknownTime')}>
        —
      </time>
    );
  }

  return (
    <time dateTime={d.toISOString()} title={d.toLocaleString()} className={className}>
      {formatTimeAgo(d, t)}
    </time>
  );
};
