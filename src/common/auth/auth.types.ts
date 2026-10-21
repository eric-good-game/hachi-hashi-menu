export interface AuthenticatedUser {
  sub: string;
  roles: string[];
}

export const DEV_ADMIN_TOKEN = 'dev-admin-token';
export const DEV_VIEWER_TOKEN = 'dev-viewer-token';
export const DEV_ADMIN_ID = '00000000-0000-4000-8000-000000000001';
export const DEV_VIEWER_ID = '00000000-0000-4000-8000-000000000002';
