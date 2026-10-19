import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AisView, BoatDetail, BoatView, BulkGroup, BulkLogEntry, BulkOrderView, BulkRegistry, BulkReport, BulkWeighing, OrderDetail, OrderLogEntry, OrderView, BulkQuality, CollisionView, Me, MessageView, NotificationView, PackingLineView,
  PortCallView, ProductReport, QualityReport, Quay, QuayLogView, TruckOrderView, UserPrefs, UserView, WeeklyReport,
} from '../../../shared/api.ts';
import type { Settings } from '../../../shared/domain/types.ts';
import type { BulkOrderCreateInput, CrewPut, OrderAssignInput, OrderCreateInput, OrderPatchInput, PortCallCreateInput, PortCallPatchInput, QuayLogCreateInput, TruckOrderCreateInput } from '../../../shared/schemas.ts';
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

/** Etter en endring på et anløp: hent lister, detaljer, ordre og båter på nytt. */
function useInvalidateCalls() {
  const qc = useQueryClient();
  return (id?: string) => {
    qc.invalidateQueries({ queryKey: ['port-calls'] });
    if (id) qc.invalidateQueries({ queryKey: ['port-call', id] });
    if (id) qc.invalidateQueries({ queryKey: ['call-log', id] });
    qc.invalidateQueries({ queryKey: ['orders'] });
    qc.invalidateQueries({ queryKey: ['order'] });
    qc.invalidateQueries({ queryKey: ['boats'] });
  };
}

// ---------------------------------------------------------------- salgsordre

export const useOrders = () => useQuery({ queryKey: ['orders'], queryFn: () => api<OrderView[]>('/orders'), refetchInterval: 60_000 });
/** Én SO med logg. `key` er id eller SO-nummer. */
export const useOrder = (key: string | null) =>
  useQuery({ queryKey: ['order', key], queryFn: () => api<OrderDetail>(`/orders/${key}`), enabled: !!key, retry: false });
export const useCallLog = (callId: string | null) =>
  useQuery({ queryKey: ['call-log', callId], queryFn: () => api<OrderLogEntry[]>(`/port-calls/${callId}/log`), enabled: !!callId });

/** Svaret etter endring av en SO: ordren, og anløp som ble tomme (klienten spør om de skal avlyses). */
export type OrderChange = { order: OrderDetail; emptied: { id: string; boat_name: string }[] };

export function useCreateOrder() {
  const inv = useInvalidateCalls();
  return useMutation({ mutationFn: (body: OrderCreateInput) => api<OrderDetail>('/orders', { body }), onSuccess: o => inv(o.calls[0]?.id) });
}
export function usePatchOrder() {
  const inv = useInvalidateCalls();
  return useMutation({
    mutationFn: ({ id, ...body }: OrderPatchInput & { id: string }) => api<OrderChange>(`/orders/${id}`, { method: 'PATCH', body }),
    onSuccess: r => inv(r.order.calls[0]?.id), onError: () => inv(),
  });
}
export function useAssignOrder() {
  const inv = useInvalidateCalls();
  return useMutation({
    mutationFn: ({ id, ...body }: OrderAssignInput & { id: string }) => api<OrderChange>(`/orders/${id}/assign`, { body }),
    onSuccess: r => inv(r.order.calls[0]?.id), onError: () => inv(),
  });
}
export function useCancelOrder() {
  const inv = useInvalidateCalls();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; version: number; reason: string }) => api<OrderChange>(`/orders/${id}/cancel`, { body }),
    onSuccess: () => inv(), onError: () => inv(),
  });
}
export function useLoadOrder(callId: string) {
  const inv = useInvalidateCalls();
  return useMutation({
    mutationFn: (orderIds: string[]) => api<PortCallView>(`/port-calls/${callId}/load-order`, { method: 'PUT', body: { order_ids: orderIds } }),
    onSuccess: () => inv(callId), onError: () => inv(callId),
  });
}
export function useCancelPortCall() {
  const inv = useInvalidateCalls();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => api<PortCallView>(`/port-calls/${id}/cancel`, { body: { reason } }),
    onSuccess: v => inv(v.id),
  });
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

export type Summary = {
  days: number; ytd: boolean; from: string; to: string;
  out: { tonnes: number; calls: number }; in: { tonnes: number; calls: number }; calls: number;
  prev: { from: string; to: string; out: { tonnes: number; calls: number }; in: { tonnes: number; calls: number }; calls: number };
};
/** days = 0: hittil i år mot samme tid i fjor. */
export const useSummary = (days: number) =>
  useQuery({ queryKey: ['summary', days], queryFn: () => api<Summary>(days ? `/reports/summary?days=${days}` : '/reports/summary?ytd=1'), placeholderData: keepPreviousData, staleTime: 5 * 60_000 });

// ---------------------------------------------------------------- biler, bulk, produksjon

export const useTruckOrders = () =>
  useQuery({ queryKey: ['trucks'], queryFn: () => api<TruckOrderView[]>('/trucks'), refetchInterval: 5 * 60_000 });

function useTruckMutation<V>(fn: (v: V) => Promise<TruckOrderView>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSettled: () => qc.invalidateQueries({ queryKey: ['trucks'] }) });
}
export const useCreateTruckOrder = () => useTruckMutation((body: TruckOrderCreateInput) => api<TruckOrderView>('/trucks', { body }));
export const usePickupTruck = () =>
  useTruckMutation(({ id, undo }: { id: string; undo?: boolean }) => api<TruckOrderView>(`/trucks/${id}/pickup`, { body: { undo } }));
export const useCancelTruck = () => useTruckMutation((id: string) => api<TruckOrderView>(`/trucks/${id}/cancel`, { body: {} }));

export const useBulkQualities = () => useQuery({ queryKey: ['bulk-qualities'], queryFn: () => api<BulkQuality[]>('/bulk/qualities'), ...STATIC });
export const useBulkOrders = () =>
  useQuery({ queryKey: ['bulk'], queryFn: () => api<BulkOrderView[]>('/bulk/orders'), refetchInterval: 30_000 });

function useBulkMutation<V>(fn: (v: V) => Promise<BulkOrderView>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSettled: () => qc.invalidateQueries({ queryKey: ['bulk'] }) });
}
export const useCreateBulkOrder = () => useBulkMutation((body: BulkOrderCreateInput) => api<BulkOrderView>('/bulk/orders', { body }));
/** Start, neste steg eller avlys. */
export type BulkActionName = 'start' | 'step-done' | 'stop' | 'continue' | 'cancel';
export const useBulkAction = () =>
  useBulkMutation(({ id, action, weighed }: { id: string; action: BulkActionName; weighed?: number }) =>
    api<BulkOrderView>(`/bulk/orders/${id}/${action}`, { body: action === 'step-done' ? { weighed_tonnes: weighed } : {} }));
export const useBulkLog = (id: string | null) =>
  useQuery({ queryKey: ['bulk', 'log', id], queryFn: () => api<BulkLogEntry[]>(`/bulk/orders/${id}/log`), enabled: !!id });
export const useBulkRegistry = () => useQuery({ queryKey: ['bulk', 'registry'], queryFn: () => api<BulkRegistry>('/bulk/registry') });
export const useBulkWeighings = (from: string, to: string) =>
  useQuery({ queryKey: ['bulk', 'weighings', from, to], queryFn: () => api<BulkWeighing[]>(`/bulk/weighings?from=${from}&to=${to}`), refetchInterval: 30_000 });
export const useBulkReport = (from: string, to: string, group: BulkGroup) =>
  useQuery({ queryKey: ['bulk', 'report', from, to, group], queryFn: () => api<BulkReport>(`/bulk/report?from=${from}&to=${to}&group=${group}`), placeholderData: keepPreviousData });
/** Lagre i registrene: kind = haulers | customers | drivers | vehicles; id = oppdater. */
export function useSaveRegistry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ kind, id, body }: { kind: 'haulers' | 'customers' | 'drivers' | 'vehicles'; id?: string; body: Record<string, unknown> }) =>
      api(`/bulk/registry/${kind}${id ? `/${id}` : ''}`, { method: id ? 'PATCH' : 'POST', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bulk'] }),
  });
}

export const useProduction = () =>
  // Silonivået er beregnet fra klokka, så visningen tegnes på nytt uansett; data hentes sjeldnere.
  useQuery({ queryKey: ['production'], queryFn: () => api<PackingLineView[]>('/production'), refetchInterval: 60_000 });

function useProductionMutation<V>(fn: (v: V) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSettled: () => qc.invalidateQueries({ queryKey: ['production'] }) });
}
export const useCreateProductionOrder = () =>
  useProductionMutation((body: { line_id: string; product_id: string; tonnes: number; notes?: string | null }) => api('/production/orders', { body }));
export const useProductionAction = () =>
  useProductionMutation(({ id, action }: { id: string; action: 'start' | 'finish' | 'cancel' }) => api(`/production/orders/${id}/${action}`, { body: {} }));
export const useSiloFill = () =>
  useProductionMutation((body: { line_id: string; tonnes: number }) => api('/production/fills', { body }));

/** Lagre egne valg (f.eks. periode på kaiplanen). Oppdaterer «meg» med en gang. */
export function useSavePrefs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (prefs: UserPrefs) => api<Me>('/me/prefs', { method: 'PUT', body: prefs }),
    onMutate: prefs => qc.setQueryData<Me>(['me'], m => (m ? { ...m, prefs: { ...m.prefs, ...prefs } } : m)),
    onSuccess: me => qc.setQueryData(['me'], me),
  });
}
