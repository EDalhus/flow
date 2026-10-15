import type { Me } from '../../../shared/api.ts';
import type { UserRole } from '../../../shared/domain/types.ts';

// Samme regler som API-et (worker/auth/access.ts). Frontend skjuler bare knapper; API-et avgjør.
const has = (me: Me | undefined, ...roles: UserRole[]) => !!me && (me.roles.includes('admin') || roles.some(r => me.roles.includes(r)));

export const canPlan = (me?: Me) => has(me, 'salg', 'produksjon');
export const canCrew = (me?: Me) => has(me, 'produksjon');
export const canQuayLog = (me?: Me) => has(me, 'kaiarbeider', 'produksjon');
export const canFlag = (me?: Me) => has(me, 'produksjon');
export const canBoats = (me?: Me) => has(me, 'salg', 'produksjon');
