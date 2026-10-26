import { useContext } from 'react'
import { AuthContext } from './auth.tsx'
import { supabase } from './supabase.ts'

export const useAuth = () => useContext(AuthContext)

const SIGNUP_PROBLEMS: Record<string, string> = {
  invalid_invite: 'That invite code is not valid (it may be used up or expired).',
  invalid_username: 'Usernames are 3–24 characters: lowercase letters, numbers and _.',
  username_taken: 'That username is taken.',
}

export async function signUp(input: { email: string; password: string; username: string; inviteCode: string; displayName: string }) {
  if (!supabase) throw new Error('Accounts are not set up on this site')
  const username = input.username.trim().toLowerCase()
  const { data: check, error: checkError } = await supabase.rpc('check_signup', { invite_code: input.inviteCode.trim(), username })
  if (checkError) throw new Error(checkError.message)
  if (check !== 'ok') throw new Error(SIGNUP_PROBLEMS[check as string] ?? String(check))
  const { error } = await supabase.auth.signUp({
    email: input.email.trim(),
    password: input.password,
    options: {
      data: { invite_code: input.inviteCode.trim(), username, display_name: input.displayName.trim() },
      emailRedirectTo: window.location.origin + import.meta.env.BASE_URL,
    },
  })
  if (error) throw new Error(error.message)
}

export async function signIn(email: string, password: string) {
  if (!supabase) throw new Error('Accounts are not set up on this site')
  const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
  if (error) throw new Error(error.message)
}

export async function sendPasswordReset(email: string) {
  if (!supabase) throw new Error('Accounts are not set up on this site')
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
    redirectTo: `${window.location.origin}${import.meta.env.BASE_URL}?view=account&reset=1`,
  })
  if (error) throw new Error(error.message)
}

export async function signOut() {
  await supabase?.auth.signOut()
}
