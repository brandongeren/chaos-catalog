import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// The project URL and the public anon key are build-time settings (GitHub secrets in CI, .env.local locally).
// Both are meant to be public: what anyone may read or write is enforced by the database (supabase/migrations).
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

/** Undefined when the build has no Supabase settings: search still works, accounts and collections don't. */
export const supabase: SupabaseClient | undefined = url && key ? createClient(url, key) : undefined

export interface Profile {
  id: string
  username: string
  display_name: string
  city: string
  is_admin: boolean
  profile_public: boolean
  show_locations: boolean
  show_prices: boolean
  group_ordered_default: boolean
  /** Borrow/trade availability for newly added cards (boxes and groups can override). */
  default_availability?: 'none' | 'borrow' | 'trade'
}

export function requireSupabase(): SupabaseClient {
  if (!supabase) throw new Error('Accounts are not set up on this site (no Supabase settings in the build)')
  return supabase
}

/** Public URL of an uploaded photo (box/group thumbnails live in the public "photos" bucket). */
export const photoUrl = (path: string | null | undefined) =>
  path && supabase ? supabase.storage.from('photos').getPublicUrl(path).data.publicUrl : undefined
