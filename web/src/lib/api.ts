import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import { tokenStorage } from './auth';
import { queryClient } from './queryClient';
import { useAuthStore } from '@/store/authStore';
import type {
  AuthTokens, User, PaginatedResponse, ListParams,
  Extension, Trunk, DIDNumber, OutboundRoute, RingGroup,
  Queue, QueueMember, QueueStats,
  IVRMenu, TimeCondition, AIAgent, KnowledgeBase, KBDocument,
  Call, Recording, Transcript, Voicemail, Message, Webhook,
  DashboardStats, Report,
} from './types';

const BASE = import.meta.env.VITE_API_URL ?? '/api';

export const api = axios.create({
  baseURL: BASE,
  timeout: 30_000,
});

/**
 * Active-tenant override for superadmins. Stored as a plain tenant id under
 * this key; the API honors `X-Tenant-Id` only for superadmins, so sending it
 * unconditionally is safe (ignored for everyone else).
 */
export const ACTIVE_TENANT_KEY = 'aipbx-active-tenant';
export const tenantContext = {
  get: () => localStorage.getItem(ACTIVE_TENANT_KEY),
  set: (id: string | null) => {
    if (id) localStorage.setItem(ACTIVE_TENANT_KEY, id);
    else localStorage.removeItem(ACTIVE_TENANT_KEY);
  },
};

// ─── Request interceptor: attach Bearer token + active tenant ─────────────────
api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = tokenStorage.getAccess();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  // Only superadmins may target another tenant. The server enforces this too,
  // but we don't even send the header otherwise (avoids confusing a normal
  // user's session if the key is ever set by something else in the origin).
  const activeTenant = tenantContext.get();
  if (activeTenant && useAuthStore.getState().user?.role === 'superadmin') {
    config.headers['X-Tenant-Id'] = activeTenant;
  }
  return config;
});

// ─── Response interceptor: token refresh on 401 ──────────────────────────────
let isRefreshing = false;
let pendingQueue: Array<{ resolve: (v: string) => void; reject: (e: unknown) => void }> = [];

function processQueue(err: unknown, token: string | null) {
  pendingQueue.forEach((p) => (err ? p.reject(err) : p.resolve(token!)));
  pendingQueue = [];
}

api.interceptors.response.use(
  (res) => res,
  async (error: AxiosError) => {
    const original = error.config as InternalAxiosRequestConfig & { _retry?: boolean };
    if (error.response?.status !== 401 || original._retry) {
      return Promise.reject(error);
    }
    if (isRefreshing) {
      return new Promise((resolve, reject) => {
        pendingQueue.push({
          resolve: (token) => {
            original.headers.Authorization = `Bearer ${token}`;
            resolve(api(original));
          },
          reject,
        });
      });
    }
    original._retry = true;
    isRefreshing = true;
    try {
      const refresh = tokenStorage.getRefresh();
      if (!refresh) throw new Error('No refresh token');
      const { data } = await axios.post<{ accessToken: string }>(`${BASE}/auth/refresh`, {
        refreshToken: refresh,
      });
      tokenStorage.setAccess(data.accessToken);
      processQueue(null, data.accessToken);
      original.headers.Authorization = `Bearer ${data.accessToken}`;
      return api(original);
    } catch (refreshErr) {
      processQueue(refreshErr, null);
      tokenStorage.clear();
      queryClient.clear();
      window.location.href = '/login';
      return Promise.reject(refreshErr);
    } finally {
      isRefreshing = false;
    }
  }
);

// ─── Auth endpoints ───────────────────────────────────────────────────────────
export const authApi = {
  login: (email: string, password: string, mfa_code?: string) =>
    api.post<AuthTokens>('/auth/login', { email, password, mfa_code }).then((r) => r.data),
  refresh: (refreshToken: string) =>
    api.post<{ accessToken: string }>('/auth/refresh', { refreshToken }).then((r) => r.data),
  me: () => api.get<User>('/auth/me').then((r) => r.data),
  logout: () => api.post('/auth/logout').catch(() => null),
  updateProfile: (body: { first_name?: string; last_name?: string; avatar_url?: string | null }) =>
    api.patch<User>('/auth/me', body).then((r) => r.data),
  changePassword: (current_password: string, new_password: string) =>
    api.post<{ ok: boolean }>('/auth/change-password', { current_password, new_password }).then((r) => r.data),
  mfaSetup: () =>
    api.post<{ secret: string; otpauth_url: string }>('/auth/mfa/setup').then((r) => r.data),
  mfaEnable: (code: string) =>
    api.post<{ ok: boolean; mfa_enabled: boolean }>('/auth/mfa/enable', { code }).then((r) => r.data),
  mfaDisable: (password: string) =>
    api.post<{ ok: boolean; mfa_enabled: boolean }>('/auth/mfa/disable', { password }).then((r) => r.data),
};

// ─── Generic CRUD factory ─────────────────────────────────────────────────────
function crud<T, C = Partial<T>>(resource: string) {
  return {
    list: (params?: ListParams) =>
      api.get<PaginatedResponse<T>>(`/${resource}`, { params }).then((r) => r.data),
    get: (id: string) =>
      api.get<T>(`/${resource}/${id}`).then((r) => r.data),
    create: (body: C) =>
      api.post<T>(`/${resource}`, body).then((r) => r.data),
    update: (id: string, body: Partial<C>) =>
      api.put<T>(`/${resource}/${id}`, body).then((r) => r.data),
    delete: (id: string) =>
      api.delete(`/${resource}/${id}`).then((r) => r.data),
  };
}

// ─── Resource APIs ────────────────────────────────────────────────────────────
export const usersApi = crud<User>('users');
export const extensionsApi = crud<Extension>('extensions');
export const trunksApi = crud<Trunk>('trunks');
export const didNumbersApi = crud<DIDNumber>('did_numbers');
export const outboundRoutesApi = crud<OutboundRoute>('outbound_routes');
export const ringGroupsApi = crud<RingGroup>('ring_groups');
export const queuesApi = {
  ...crud<Queue>('queues'),
  members: (id: string) =>
    api.get<QueueMember[]>(`/queues/${id}/members`).then((r) => r.data),
  addMember: (id: string, extensionId: string) =>
    api.post<QueueMember>(`/queues/${id}/members`, { extension_id: extensionId }).then((r) => r.data),
  removeMember: (id: string, memberId: string) =>
    api.delete(`/queues/${id}/members/${memberId}`).then((r) => r.data),
  stats: (id: string) =>
    api.get<QueueStats>(`/queues/${id}/stats`).then((r) => r.data),
};
// ─── Tenants (platform / superadmin) ─────────────────────────────────────────
export interface TenantUsage {
  extensions: number;
  users: number;
  ai_agents: number;
  did_numbers: number;
  trunks: number;
  active_calls: number;
}
export interface Tenant {
  id: string;
  name: string;
  slug: string;
  domain: string | null;
  plan: 'free' | 'pro' | 'enterprise';
  max_extensions: number;
  max_concurrent_calls: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  usage?: TenantUsage;
}
export interface TenantCreateInput {
  name: string;
  slug: string;
  domain?: string;
  plan?: 'free' | 'pro' | 'enterprise';
  max_extensions?: number;
  max_concurrent_calls?: number;
  admin?: { email: string; password: string; first_name?: string; last_name?: string };
}
export const tenantsApi = {
  list: (params?: ListParams) =>
    api.get<PaginatedResponse<Tenant>>('/tenants', { params }).then((r) => r.data),
  get: (id: string) => api.get<Tenant>(`/tenants/${id}`).then((r) => r.data),
  create: (body: TenantCreateInput) =>
    api.post<Tenant & { adminUserId: string | null }>('/tenants', body).then((r) => r.data),
  update: (id: string, body: Partial<Tenant>) =>
    api.patch<Tenant>(`/tenants/${id}`, body).then((r) => r.data),
  suspend: (id: string) => api.post<Tenant>(`/tenants/${id}/suspend`).then((r) => r.data),
  activate: (id: string) => api.post<Tenant>(`/tenants/${id}/activate`).then((r) => r.data),
  remove: (id: string, force = false) =>
    api.delete(`/tenants/${id}${force ? '?force=1' : ''}`).then((r) => r.data),
  current: () =>
    api
      .get<{ tenant: Tenant; usage: TenantUsage; impersonating: boolean; homeTenantId: string }>(
        '/tenants/context/current',
      )
      .then((r) => r.data),
};

// ─── Carrier integrations (Twilio Elastic SIP Trunking) ──────────────────────
export interface TwilioCredsInput {
  accountSid: string;
  authToken?: string;
  apiKeySid?: string;
  apiKeySecret?: string;
}
export interface TwilioNumber {
  sid: string;
  phoneNumber: string;
  friendlyName: string | null;
  voice: boolean;
}
export interface TwilioVerifyResult {
  account: { friendlyName: string; status: string };
  numbers: TwilioNumber[];
}
export interface TwilioConnectInput extends TwilioCredsInput {
  label?: string;
  transport?: 'udp' | 'tls';
  importNumbers?: boolean;
  assignNumbersOnTwilio?: boolean;
  defaultDestType?: string;
  defaultDestId?: string | null;
}
export interface TwilioConnectResult {
  trunkId: string;
  twilioTrunkSid: string;
  terminationUri: string;
  originationTarget: string;
  numbersImported: number;
  outboundRouteId: string;
  numbers: Array<{ e164: string; sid: string }>;
}
export const twilioApi = {
  verify: (body: TwilioCredsInput) =>
    api.post<TwilioVerifyResult>('/integrations/twilio/verify', body).then((r) => r.data),
  connect: (body: TwilioConnectInput) =>
    api.post<TwilioConnectResult>('/integrations/twilio/connect', body).then((r) => r.data),
};

export const ivrMenusApi = crud<IVRMenu>('ivr_menus');
export const timeConditionsApi = crud<TimeCondition>('time_conditions');
export const aiAgentsApi = {
  ...crud<AIAgent>('ai_agents'),
  test: (id: string, message: string, history: Array<{ role: string; content: string }>) =>
    api
      .post<{ reply: string; tool_calls?: unknown[]; usage?: unknown }>(
        `/ai_agents/${id}/test`,
        { message, history }
      )
      .then((r) => r.data),
};
export const knowledgeBasesApi = {
  ...crud<KnowledgeBase>('knowledge_bases'),
  documents: (id: string) =>
    api.get<PaginatedResponse<KBDocument>>(`/knowledge_bases/${id}/documents`).then((r) => r.data),
  uploadDocument: (id: string, file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return api.post<KBDocument>(`/knowledge_bases/${id}/documents`, fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then((r) => r.data);
  },
  deleteDocument: (kbId: string, docId: string) =>
    api.delete(`/knowledge_bases/${kbId}/documents/${docId}`).then((r) => r.data),
};
export const callsApi = {
  ...crud<Call>('calls'),
  transcript: (id: string) =>
    api.get<Transcript>(`/calls/${id}/transcript`).then((r) => r.data),
  recording: (id: string) =>
    api.get<Recording>(`/calls/${id}/recording`).then((r) => r.data),
};
export const recordingsApi = crud<Recording>('recordings');
export const voicemailsApi = {
  ...crud<Voicemail>('voicemails'),
  markRead: (id: string) =>
    api.patch(`/voicemails/${id}/read`).then((r) => r.data),
};
export const messagesApi = crud<Message>('messages');
export const webhooksApi = crud<Webhook>('webhooks');
export const dashboardApi = {
  stats: () =>
    api.get<DashboardStats>('/dashboard/stats').then((r) => r.data),
};
export const reportsApi = {
  list: (params?: ListParams) =>
    api.get<PaginatedResponse<Report>>('/reports', { params }).then((r) => r.data),
  generate: (type: string, params: Record<string, unknown>) =>
    api.post<Report>('/reports', { type, ...params }).then((r) => r.data),
};

// ─── Departments ──────────────────────────────────────────────────────────────
export interface Department {
  id: string;
  tenant_id: string;
  name: string;
  description?: string;
  manager_user_id?: string;
  member_count: number;
  extension_count: number;
  created_at: string;
}

export interface DepartmentMember {
  id: string;
  user_id: string;
  role: 'owner' | 'manager' | 'receptionist' | 'user';
  email: string;
  first_name: string;
  last_name: string;
}

export interface DepartmentDetail extends Department {
  members: DepartmentMember[];
}

export const departmentsApi = {
  list: (params?: ListParams) =>
    api.get<PaginatedResponse<Department>>('/departments', { params }).then((r) => r.data),
  get: (id: string) =>
    api.get<DepartmentDetail>(`/departments/${id}`).then((r) => r.data),
  create: (body: { name: string; description?: string; manager_user_id?: string }) =>
    api.post<Department>('/departments', body).then((r) => r.data),
  update: (id: string, body: { name?: string; description?: string; manager_user_id?: string | null }) =>
    api.patch<Department>(`/departments/${id}`, body).then((r) => r.data),
  remove: (id: string) =>
    api.delete(`/departments/${id}`).then((r) => r.data),
  setMember: (id: string, body: { user_id: string; role: DepartmentMember['role'] }) =>
    api.put<DepartmentMember>(`/departments/${id}/members`, body).then((r) => r.data),
  removeMember: (id: string, userId: string) =>
    api.delete(`/departments/${id}/members/${userId}`).then((r) => r.data),
};

// ─── Access / RBAC ────────────────────────────────────────────────────────────
export interface AccessMe {
  superadmin: boolean;
  systemRole: string;
  global: string[];
  byDepartment: Record<string, string[]>;
}

export interface RoleMatrixEntry {
  permissions: string[];
  editable: boolean;
}

export interface PermissionCatalogItem {
  key: string;
  category: string;
  label: string;
}

export interface RoleMatrix {
  catalog: PermissionCatalogItem[];
  system: Record<string, RoleMatrixEntry>;
  department: Record<string, RoleMatrixEntry>;
}

export const accessApi = {
  me: () => api.get<AccessMe>('/access/me').then((r) => r.data),
  matrix: () => api.get<RoleMatrix>('/access/matrix').then((r) => r.data),
  setRole: (scope: 'system' | 'department', role: string, permissions: string[]) =>
    api.put<RoleMatrixEntry>(`/access/matrix/${scope}/${role}`, { permissions }).then((r) => r.data),
  resetRole: (scope: 'system' | 'department', role: string) =>
    api.delete(`/access/matrix/${scope}/${role}`).then((r) => r.data),
};
