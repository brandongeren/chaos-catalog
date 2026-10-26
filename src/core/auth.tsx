import { createContext, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase, type Profile } from './supabase.ts'

export interface Auth {
  enabled: boolean
  ready: boolean
  session: Session | null
  profile: Profile | null
  reloadProfile: () => Promise<void>
}

export const AuthContext = createContext<Auth>({ enabled: false, ready: true, session: null, profile: null, reloadProfile: async () => {} })

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [ready, setReady] = useState(!supabase)

  const loadProfile = useCallback(async (s: Session | null) => {
    if (!supabase || !s) return setProfile(null)
    // The last profile seen is kept on the device, so the app (and your collection) still opens offline.
    const key = `profile:${s.user.id}`
    const saved = localStorage.getItem(key)
    if (saved) setProfile(JSON.parse(saved) as Profile) // show at once; refreshed below
    try {
      const { data, error } = await supabase.from('profiles').select('*').eq('id', s.user.id).maybeSingle()
      if (error) throw new Error(error.message)
      if (data) localStorage.setItem(key, JSON.stringify(data))
      setProfile((data as Profile | null) ?? null)
    } catch {
      if (!saved) setProfile(null)
    }
  }, [])

  useEffect(() => {
    if (!supabase) return
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setReady(true)
      void loadProfile(data.session)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s)
      void loadProfile(s)
    })
    return () => sub.subscription.unsubscribe()
  }, [loadProfile])

  const value = useMemo<Auth>(
    () => ({ enabled: !!supabase, ready, session, profile, reloadProfile: () => loadProfile(session) }),
    [ready, session, profile, loadProfile],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

