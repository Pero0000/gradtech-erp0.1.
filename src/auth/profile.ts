export interface AppProfile {
  id: string;
  email: string;
  approved: boolean;
  is_admin: boolean;
  radnik_id: string | null;
  company_id: string;
  is_platform_owner: boolean;
  is_voditelj: boolean;
}
