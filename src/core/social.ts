// Friends, wants, borrow/trade requests, "who has it" and trade matches (supabase/migrations/0003_social.sql).

import { requireSupabase } from './supabase.ts'

export interface Friend {
  id: string
  username: string
  display_name: string
  city: string
  status: 'pending' | 'accepted'
  incoming: boolean
}

export interface Holder {
  user_id: string
  username: string
  display_name: string
  city: string
  is_friend: boolean
  card_key: string
  qty: number
  availability: 'none' | 'borrow' | 'trade' | 'both'
}

export interface Want {
  card_key: string
  qty: number
  note: string
}

export interface TradeMatch {
  direction: 'they_have' | 'they_want'
  user_id: string
  username: string
  city: string
  is_friend: boolean
  card_key: string
  qty: number
}

export interface CardRequest {
  id: string
  from_user: string
  to_user: string
  kind: 'borrow' | 'trade'
  card_key: string
  qty: number
  message: string
  reply: string
  status: 'pending' | 'accepted' | 'declined' | 'cancelled' | 'done'
  created_at: string
}

const unwrap = <T>({ data, error }: { data: T | null; error: { message: string } | null }): T => {
  if (error) throw new Error(error.message)
  return data as T
}

export const myFriends = async () => unwrap<Friend[]>(await requireSupabase().rpc('my_friends'))
export const requestFriend = async (username: string) =>
  unwrap<string>(await requireSupabase().rpc('request_friend', { other_username: username }))
export const respondFriend = async (other: string, accept: boolean) =>
  unwrap(await requireSupabase().rpc('respond_friend', { other, accept }))

export const whoHas = async (cardKeys: string[]) =>
  cardKeys.length ? unwrap<Holder[]>(await requireSupabase().rpc('who_has', { card_keys: cardKeys })) : []

export const tradeMatches = async () => unwrap<TradeMatch[]>(await requireSupabase().rpc('trade_matches'))

export async function wantsOf(ownerId: string): Promise<Want[]> {
  return unwrap(await requireSupabase().from('wants').select('card_key, qty, note').eq('owner_id', ownerId).order('created_at'))
}
export async function setWant(cardKey: string, qty: number, note = '') {
  unwrap(await requireSupabase().from('wants').upsert({ card_key: cardKey, qty, note }, { onConflict: 'owner_id,game,card_key' }))
}
export async function removeWant(cardKey: string) {
  unwrap(await requireSupabase().from('wants').delete().eq('card_key', cardKey))
}

export async function myRequests(): Promise<CardRequest[]> {
  return unwrap(await requireSupabase().from('requests').select('*').order('created_at', { ascending: false }).limit(200))
}
export async function sendRequest(r: { to_user: string; kind: 'borrow' | 'trade'; card_key: string; qty: number; message: string }) {
  unwrap(await requireSupabase().from('requests').insert(r))
}
export const answerRequest = async (id: string, status: CardRequest['status'], reply = '') =>
  unwrap(await requireSupabase().rpc('answer_request', { request_id: id, new_status: status, reply_text: reply }))

/** Usernames for request lists (profiles you can see). */
export async function usernames(ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map()
  const rows = unwrap<{ id: string; username: string }[]>(await requireSupabase().from('profiles').select('id, username').in('id', ids))
  return new Map(rows.map((r) => [r.id, r.username]))
}
