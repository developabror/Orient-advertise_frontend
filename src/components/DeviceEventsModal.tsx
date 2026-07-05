import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EmptyState } from './ui/EmptyState';
import { Modal } from './ui/Modal';
import { Pagination } from './ui/Pagination';
import { Spinner } from './ui/Spinner';
import { EventRow } from './EventRow';
import { useDeviceEvents } from '@hooks/useDeviceEvents';

interface Props {
  isOpen: boolean;
  deviceId: string;
  onClose: () => void;
}

const HISTORY_PAGE_SIZE = 50;

export const DeviceEventsModal = ({ isOpen, deviceId, onClose }: Props) => {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);

  // Reset to first page each time the modal opens — operators typically expect
  // the most-recent activity, not where they were last time.
  useEffect(() => {
    if (isOpen) setPage(1);
  }, [isOpen]);

  // Pass an empty deviceId when closed so the hook stays idle.
  const { events, totalPages, isLoading } = useDeviceEvents(isOpen ? deviceId : undefined, {
    size: HISTORY_PAGE_SIZE,
    page,
  });

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t('deviceEventsModal.title')} size="lg">
      <div className="oa-events-modal">
        {isLoading ? (
          <div className="oa-events-modal__state">
            <Spinner size="lg" label={t('deviceEventsModal.loading')} />
          </div>
        ) : events.length === 0 ? (
          <EmptyState
            title={t('deviceEventsModal.emptyTitle')}
            description={t('deviceEventsModal.emptyDescription')}
          />
        ) : (
          <ol className="oa-events-modal__list">
            {events.map((e) => (
              <EventRow key={e.id} event={e} />
            ))}
          </ol>
        )}

        {totalPages > 1 && (
          <div className="oa-events-modal__pagination">
            <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />
          </div>
        )}
      </div>
    </Modal>
  );
};
