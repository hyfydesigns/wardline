// Typed API client. Talks to the Fastify server through Vite's dev proxy, so
// all paths are same-origin relative.

import { apiUrl } from './config';

export type Severity = 'critical' | 'concerning' | 'informational';
export type AlertStatus = 'open' | 'reviewed' | 'dismissed' | 'false_positive';

export interface Parent { id: string; email: string; name: string; plan: string; mfaEnabled?: boolean; role?: string; }

export interface HouseholdMember {
  id: string; name: string; email: string; role: string;
  mfaEnabled: boolean; joinedAt: string; isYou: boolean;
}
export interface HouseholdInvite {
  id: string; email: string; role: string; createdAt: string; expiresAt: string;
}
export interface HouseholdInfo {
  household: { id: string; name: string; plan: string };
  members: HouseholdMember[];
  invitations: HouseholdInvite[];
  yourRole: string;
}
export interface InvitePreview {
  email: string; householdName: string; invitedByName: string; usable: boolean;
}

export interface Child {
  id: string;
  name: string;
  color: string;
  limitMin: number;
  todayMin: number;
  openAlerts: number;
  blockedToday: number;
  spark: number[];
  device: { name: string; online: boolean; lastSeen: string | null; tamper: string } | null;
}

export interface Alert {
  id: string;
  childId: string;
  childName: string;
  childColor: string;
  category: string;
  severity: Severity;
  confidence: number | null;
  label: string;
  snippet: string | null;
  source: string;
  occurredAt: string;
  status: AlertStatus;
  deviceName: string;
}

export interface AlertsResponse {
  alerts: Alert[];
  counts: { critical: number; concerning: number; informational: number; all: number };
}

export interface ScreenTimeReport {
  days: string[];
  series: { childId: string; name: string; color: string; values: number[] }[];
}
export interface CategorySlice { category: string; minutes: number; pct: number; }
export interface SeverityWeek { week: string; critical: number; concerning: number; informational: number; }

export interface Device {
  id: string; name: string; agentVersion: string; browserCoverage: string;
  tamperStatus: string; lastSeen: string | null; childName: string; childColor: string; online: boolean;
}
export interface Schedule {
  id: string; name: string; kind: string; days: number[]; startMin: number; endMin: number; scope: string;
}

export interface Settings {
  filters: { adult: boolean; gambling: boolean; social: boolean; gaming: boolean; streaming: boolean };
  safeSearch: boolean;
  customBlocked: string[];
  customAllowed?: string[];
  alerts: { sensitivity: 'cautious' | 'balanced' | 'strict'; email: boolean; push: boolean };
  screenshots: { enabled: boolean; retentionDays: number };
}

const TOKEN_KEY = 'wl_token';
export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (t: string) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

class ApiError extends Error {
  /** True when the server is asking for a second factor. */
  mfaRequired: boolean;
  constructor(public status: number, message: string, body?: { mfaRequired?: boolean }) {
    super(message);
    this.mfaRequired = !!body?.mfaRequired;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = tokenStore.get();
  const res = await fetch(apiUrl(path), {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(options.headers ?? {}),
    },
  });
  if (!res.ok) {
    let msg = res.statusText;
    let body: { mfaRequired?: boolean } | undefined;
    try {
      body = await res.json();
      msg = (body as { error?: string })?.error ?? msg;
    } catch { /* ignore */ }
    throw new ApiError(res.status, msg, body);
  }
  return res.json() as Promise<T>;
}

export const api = {
  login: (email: string, password: string, code?: string) =>
    request<{ token: string; parent: Parent }>('/auth/login', {
      method: 'POST', body: JSON.stringify({ email, password, code }),
    }),
  signup: (input: { name: string; email: string; password: string; householdName?: string; childName: string; childLimitMin?: number }) =>
    request<{ token: string; parent: Parent }>('/auth/signup', {
      method: 'POST', body: JSON.stringify(input),
    }),
  invitePreview: (token: string) => request<InvitePreview>(`/auth/invite/${encodeURIComponent(token)}`),
  acceptInvite: (token: string, name: string, password: string) =>
    request<{ token: string; parent: Parent }>('/auth/accept-invite', {
      method: 'POST', body: JSON.stringify({ token, name, password }),
    }),
  household: () => request<HouseholdInfo>('/api/household'),
  inviteCoParent: (email: string) =>
    request<{ id: string; email: string; token: string; expiresAt: string; invitePath: string }>('/api/household/invites', {
      method: 'POST', body: JSON.stringify({ email }),
    }),
  revokeInvite: (id: string) => request<{ ok: true }>(`/api/household/invites/${id}`, { method: 'DELETE' }),
  removeMember: (id: string) => request<{ ok: true }>(`/api/household/members/${id}`, { method: 'DELETE' }),
  twoFactorSetup: () => request<{ secret: string; otpauthUri: string }>('/api/2fa/setup', { method: 'POST' }),
  twoFactorEnable: (code: string) => request<{ mfaEnabled: boolean }>('/api/2fa/enable', { method: 'POST', body: JSON.stringify({ code }) }),
  twoFactorDisable: (code: string) => request<{ mfaEnabled: boolean }>('/api/2fa/disable', { method: 'POST', body: JSON.stringify({ code }) }),
  me: () => request<{ parent: Parent | null; settings: Settings; children: { id: string; name: string; color: string }[] }>('/api/me'),
  children: () => request<Child[]>('/api/children'),
  alerts: (childId?: string, severity?: string) => {
    const q = new URLSearchParams();
    if (childId) q.set('childId', childId);
    if (severity) q.set('severity', severity);
    const qs = q.toString();
    return request<AlertsResponse>(`/api/alerts${qs ? `?${qs}` : ''}`);
  },
  setAlertStatus: (id: string, status: AlertStatus) =>
    request<{ id: string; status: AlertStatus }>(`/api/alerts/${id}/status`, {
      method: 'POST', body: JSON.stringify({ status }),
    }),
  screenTime: (days: number) => request<ScreenTimeReport>(`/api/reports/screen-time?days=${days}`),
  categories: (childId: string, days: number) => request<CategorySlice[]>(`/api/reports/categories?childId=${childId}&days=${days}`),
  severityByWeek: (weeks: number) => request<SeverityWeek[]>(`/api/reports/alerts-by-severity?weeks=${weeks}`),
  devices: () => request<Device[]>('/api/devices'),
  addDevice: (childId: string, name: string) =>
    request<{ id: string; name: string; childId: string; deviceToken: string }>('/api/devices', {
      method: 'POST', body: JSON.stringify({ childId, name }),
    }),
  schedules: () => request<Schedule[]>('/api/schedules'),
  getSettings: () => request<Settings>('/api/settings'),
  saveSettings: (patch: Partial<Settings>) => request<Settings>('/api/settings', { method: 'PUT', body: JSON.stringify(patch) }),
};

export { ApiError };
