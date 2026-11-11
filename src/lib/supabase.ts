import { createClient } from '@supabase/supabase-js';
import { overviewFetch } from './overviewEvents';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, { global: { fetch: overviewFetch } });
