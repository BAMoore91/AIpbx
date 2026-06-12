const ACCESS_TOKEN_KEY = 'aipbx_access_token';
const REFRESH_TOKEN_KEY = 'aipbx_refresh_token';

export const tokenStorage = {
  getAccess: (): string | null => localStorage.getItem(ACCESS_TOKEN_KEY),
  getRefresh: (): string | null => localStorage.getItem(REFRESH_TOKEN_KEY),
  setAccess: (token: string): void => localStorage.setItem(ACCESS_TOKEN_KEY, token),
  setRefresh: (token: string): void => localStorage.setItem(REFRESH_TOKEN_KEY, token),
  setTokens: (access: string, refresh: string): void => {
    localStorage.setItem(ACCESS_TOKEN_KEY, access);
    localStorage.setItem(REFRESH_TOKEN_KEY, refresh);
  },
  clear: (): void => {
    localStorage.removeItem(ACCESS_TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
  },
};
