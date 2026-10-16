export interface AppProfile {
  id: string;
  email: string;
  approved: boolean;
  is_admin: boolean;
  radnik_id: string | null;
}
