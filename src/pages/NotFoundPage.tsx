import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

export const NotFoundPage = () => {
  const { t } = useTranslation();
  return (
    <section>
      <h1>{t('notFoundPage.title')}</h1>
      <Link to="/dashboard">{t('notFoundPage.backToDashboard')}</Link>
    </section>
  );
};
