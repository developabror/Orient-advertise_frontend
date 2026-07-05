import type { ReactNode } from 'react';
import { useRole } from '@hooks/useRole';
import type { Role } from '@api/auth';

interface RoleGateProps {
  roles: readonly Role[];
  children: ReactNode;
  fallback?: ReactNode;
}

// UX-only gate. Hides UI for roles that aren't allowed to use it. The API
// still enforces authorization on every request — never trust this for
// security decisions.
export const RoleGate = ({ roles, children, fallback = null }: RoleGateProps) => {
  const role = useRole();
  const allowed = role !== null && roles.includes(role);
  return <>{allowed ? children : fallback}</>;
};
