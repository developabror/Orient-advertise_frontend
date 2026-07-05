import { useAuth } from './useAuth';
import type { Role } from '@api/auth';

export const useRole = (): Role | null => {
  const { user } = useAuth();
  return user?.role ?? null;
};
