import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AisView, BoatDetail, BoatView, CollisionView, Me, MessageView, NotificationView, PortCallView, ProductReport,
  QualityReport, Quay, QuayLogView, UserView, WeeklyReport,
} from '../../../shared/api.ts';
import type { Settings } from '../../../shared/domain/types.ts';
import type { CrewPut, PortCallCreateInput, PortCallPatchInput, QuayLogCreateInput } from '../../../shared/schemas.ts';
import { api } from './api.ts';

export type { Quay };
export type Product = { id: string; name: string; skus: Sku[] };
export type Sku = { id: string; product_id: string; unit: 'BB' | 'pall'; bags_per_unit: number | null; bag_kg: number | null; pallet_type: 'europall' | 'srs' | null; kg_per_unit: number };
export type Agent = { id: string; name: string; phone: string | null };

// Oppslag som sjelden endres.
const STATIC = { staleTime: 5 * 60_000 };

export const useMe = () => useQuery({ queryKey: ['me'], queryFn: () => api<Me>('/me'), ...STATIC, retry: false });
export const useUsers = () => useQuery({ queryKey: ['users'], queryFn: () => api<UserView[]>('/users'), ...STATIC });
export const useQuays = () => useQuery({ queryKey: ['quays'], queryFn: () => api<Quay[]>('/quays'), ...STATIC });
export const useAllQuays = () => useQuery({ queryKey: ['quays', 'all'], queryFn: () => api<Quay[]>('/quays?all=1') });
export const useProducts = () => useQuery({ queryKey: ['products'], queryFn: () => api<Product[]>('/products'), ...STATIC });
export const useAgents = () => useQuery({ queryKey: ['agents'], queryFn: () => api<Agent[]>('/agents'), ...STATIC });
export const useSettings = () => useQuery({ queryKey: ['settings'], queryFn: () => api<Settings>('/settings'), ...STATIC });

export const usePortCalls = (from: string, to: string) =>
  useQuery({
    queryKey: ['port-calls', from, to],
    queryFn: () => api<{ calls: PortCallView[]; collisions: CollisionView[] }>(`/port-calls?from=${from}&to=${to}`),
    placeholderData: keepPreviousData,
    // Status som avhenger av klokka (ved kai / kaibok mangler) holdes fersk.
    refetchInterval: 60_000,
  });

export const usePortCall = (id: string | null) =>
  useQuery({ queryKey: ['port-call', id], queryFn: () => api<PortCallView>(`/port-calls/${id}`), enabled: !!id });

export const useAis = () =>
  useQuery({ queryKey: ['ais'], queryFn: () => api<AisView>('/ais'), refetchInterval: 60_000 });

export const useBoats = () => useQuery({ queryKey: ['boats'], queryFn: () => api<BoatView[]>('/boats') });
export const useBoat = (id: string | null) =>
  useQuery({ queryKey: ['boat', id], queryFn: () => api<BoatDetail>(`/boats/${id}`), enabled: !!id });

export const useMessages = (callId: string | null) =>
  useQuery({ queryKey: ['messages', callId], queryFn: () => api<MessageView[]>(`/port-calls/${callId}/messages`), enabled: !!callId });

export const useNotifications = () =>
  useQuery({ queryKey: ['notifications'], queryFn: () => api<{ unread: number; items: NotificationView[] }>('/notifications') });

export type QuayLogList = { items: QuayLogView[]; stats: { count: number; with_deviation: number; deviation_share: number | null; avg: number | null } };
export const useQuayLogs = (days: number, filter: string, q: string) =>
  useQuery({
    queryKey: ['quay-logs', days, filter, q],
    queryFn: () => api<QuayLogList>(`/quay-logs?days=${days}&filter=${filter}${q ? `&q=${encodeURIComponent(q)}` : ''}`),
    placeholderData: keepPreviousData,
  });

export const useWeeklyReport = (year: number | undefined, productId: string, direction: string) =>
  useQuery({
    queryKey: ['report-weekly', year, productId, direction],
    queryFn: () => api<WeeklyReport>(`/reports/weekly?direction=${direction}${year ? `&year=${year}` : ''}${productId ? `&product_id=${productId}` : ''}`),
    placeholderData: keepPreviousData,
  });
export const useProductReport = (direction: string) =>
  useQuery({ queryKey: ['report-products', direction], queryFn: () => api<ProductReport>(`/reports/products?direction=${direction}`), placeholderData: keepPreviousData });
export const useQualityReport = () =>
  useQuery({ queryKey: ['report-quality'], queryFn: () => api<QualityReport>('/reports/quality?weeks=8') });

// ---------------------------------------------------------------- endringer

/** Etter en endring på et anløp: hent lister, detaljer og båter på nytt. */
function useInvalidateCalls() {
  const qc = useQueryClient();
  return (id?: string) => {
    qc.invalidateQueries({ queryKey: ['port-calls'] });
    if (id) qc.invalidateQueries({ queryKey: ['port-call', id] });
    qc.invalidateQueries({ queryKey: ['boats'] });
  };
}

export function useCreatePortCall() {
  const inv = useInvalidateCalls();
  return useMutation({
    mutationFn: (body: PortCallCreateInput) => api<PortCallView>('/port-calls', { body }),
    onSuccess: v => inv(v.id),
  });
}

export function usePatchPortCall() {
  const inv = useInvalidateCalls();
  return useMutation({
    mutationFn: ({ id, ...body }: PortCallPatchInput & { id: string }) => api<PortCallView>(`/port-calls/${id}`, { method: 'PATCH', body }),
    onSuccess: v => inv(v.id),
    onError: (_e, v) => inv(v.id),
  });
}

export function usePutCrew() {
  const inv = useInvalidateCalls();
  return useMutation({
    mutationFn: ({ id, ...body }: CrewPut & { id: string }) => api<PortCallView>(`/port-calls/${id}/crew`, { method: 'PUT', body }),
    onSuccess: v => inv(v.id),
    onError: (_e, v) => inv(v.id),
  });
}

export function useSendMessage(callId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: string) => api<MessageView>(`/port-calls/${callId}/messages`, { body: { body } }),
    onSuccess: m => {
      qc.setQueryData<MessageView[]>(['messages', callId], old => (old ? [...old.filter(x => x.id !== m.id), m] : [m]));
      qc.invalidateQueries({ queryKey: ['port-calls'] });
    },
  });
}

export type QuayLogResult = { quay_log: QuayLogView; port_call: PortCallView; boat: { rating_count: number; avg_total: number | null; flag_auto: string; flag_label: string } };
export function useDeliverQuayLog(callId: string) {
  const qc = useQueryClient();
  const inv = useInvalidateCalls();
  return useMutation({
    mutationFn: (body: QuayLogCreateInput) => api<QuayLogResult>(`/port-calls/${callId}/quay-log`, { body }),
    onSuccess: r => {
      inv(callId);
      qc.invalidateQueries({ queryKey: ['messages', callId] });
      qc.invalidateQueries({ queryKey: ['quay-logs'] });
      qc.invalidateQueries({ queryKey: ['boat', r.port_call.boat.id] });
    },
  });
}

export function useReadNotifications() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { ids?: string[]; all?: boolean }) => api<{ updated: number }>('/notifications/read', { body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
}

export function useFlagOverride(boatId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { flag: string; reason: string } | null) =>
      body ? api<BoatDetail>(`/boats/${boatId}/flag`, { method: 'PUT', body }) : api<BoatDetail>(`/boats/${boatId}/flag`, { method: 'DELETE' }),
    onSuccess: b => {
      qc.setQueryData(['boat', boatId], b);
      qc.invalidateQueries({ queryKey: ['boats'] });
      qc.invalidateQueries({ queryKey: ['port-calls'] });
    },
  });
}

export function useSaveBoat() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: Record<string, unknown> }) =>
      id ? api<BoatDetail>(`/boats/${id}`, { method: 'PATCH', body }) : api<BoatDetail>('/boats', { body }),
    onSuccess: b => {
      qc.setQueryData(['boat', b.id], b);
      qc.invalidateQueries({ queryKey: ['boats'] });
      qc.invalidateQueries({ queryKey: ['port-calls'] });
    },
  });
}

export const useAllUsers = () => useQuery({ queryKey: ['users', 'all'], queryFn: () => api<UserView[]>('/users?all=1') });

export function useSaveUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: Record<string, unknown> }) =>
      id ? api<UserView>(`/users/${id}`, { method: 'PATCH', body }) : api<UserView>('/users', { body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });
}

export function useSaveQuay() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: Record<string, unknown> }) =>
      id ? api<Quay>(`/quays/${id}`, { method: 'PATCH', body }) : api<Quay>('/quays', { body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['quays'] }),
  });
}
