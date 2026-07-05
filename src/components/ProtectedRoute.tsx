import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '@hooks/useAuth';
import type { Role } from '@api/auth';

interface Props {
  readonly roles?: readonly Role[];
}

export const ProtectedRoute = ({ roles }: Props) => {
  const { user } = useAuth();
  const location = useLocation();

  if (!user) {
    const target = `${location.pathname}${location.search}${location.hash}`;
    const search = target === '/' ? '' : `?redirect=${encodeURIComponent(target)}`;
    return <Navigate to={`/login${search}`} replace />;
  }

  if (roles && !roles.includes(user.role)) {
    return <Navigate to="/forbidden" replace />;
  }

  return <Outlet />;
};
