import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

export const ForbiddenPage = () => {
  const { t } = useTranslation();

  return (
    <section>
      <h1>{t('forbiddenPage.title')}</h1>
      <p>{t('forbiddenPage.message')}</p>
      <Link to="/dashboard">{t('forbiddenPage.backToDashboard')}</Link>
    </section>
  );
};
