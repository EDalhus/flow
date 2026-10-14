import type { UserRole } from '../shared/domain/types.ts';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  short_name: string;
  initials: string;
  roles: UserRole[];
}

export type AppEnv = { Bindings: Env; Variables: { user: AuthUser } };
