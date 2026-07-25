import { createClient } from '@supabase/supabase-js';

// Accept either the EXPO_PUBLIC_ prefixed names (required for bundled Expo builds)
// or the bare names (usable in Metro dev server / server-side contexts).
const supabaseUrl =
  process.env.EXPO_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '';
const supabaseAnonKey =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? '';

if (!supabaseUrl || !supabaseAnonKey) {
  console.error(
    '[Supabase] Missing Supabase credentials. ' +
    'Set EXPO_PUBLIC_SUPABASE_URL + EXPO_PUBLIC_SUPABASE_ANON_KEY (for APK builds) ' +
    'or SUPABASE_URL + SUPABASE_ANON_KEY (for dev server).',
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    // Mobile app uses anonymous access only — no user sign-in
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false,
  },
});

export default supabase;
