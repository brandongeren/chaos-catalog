-- Phase 6: friends, wants lists, borrow/trade requests, "who has it" and trade matching.
--
-- Privacy rules:
-- - Friends can see each other's collections even when a profile isn't public (is_visible() below).
-- - "Who has it" and trade matching look at friends (all their copies, with availability shown) and at people in the
--   same city with a public profile (only copies they marked available to borrow or trade). Copies that are lent out
--   never count. Never anyone else.

-- ---------------------------------------------------------------- friends
create table public.friendships (
    -- stored once per pair, smaller id first
    user_a uuid not null references public.profiles (id) on delete cascade
    , user_b uuid not null references public.profiles (id) on delete cascade
    , requested_by uuid not null references public.profiles (id) on delete cascade
    , status text not null default 'pending' check (status in ('pending', 'accepted'))
    , created_at timestamptz not null default now()
    , primary key (user_a, user_b)
    , check (user_a < user_b)
);

alter table public.friendships enable row level security;

create policy "friendships: your own" on public.friendships
    for select using (auth.uid() in (user_a, user_b));

create function public.are_friends(x uuid, y uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1 from public.friendships f
        where f.user_a = least(x, y) and f.user_b = greatest(x, y) and f.status = 'accepted'
    );
$$;

-- Asks someone to be friends; if they already asked you, this accepts.
create function public.request_friend(other_username text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
    me uuid := auth.uid();
    other uuid;
    existing public.friendships;
begin
    if me is null then raise exception 'Not signed in'; end if;
    select id into other from public.profiles where username = lower(trim(other_username));
    if other is null then raise exception 'No user called %', other_username; end if;
    if other = me then raise exception 'That''s you'; end if;
    select * into existing from public.friendships where user_a = least(me, other) and user_b = greatest(me, other);
    if found then
        if existing.status = 'pending' and existing.requested_by = other then
            update public.friendships set status = 'accepted' where user_a = existing.user_a and user_b = existing.user_b;
            return 'accepted';
        end if;
        return existing.status;
    end if;
    insert into public.friendships (user_a, user_b, requested_by) values (least(me, other), greatest(me, other), me);
    return 'requested';
end;
$$;

create function public.respond_friend(other uuid, accept boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    me uuid := auth.uid();
begin
    if accept then
        update public.friendships set status = 'accepted'
        where user_a = least(me, other) and user_b = greatest(me, other) and requested_by = other and status = 'pending';
    else
        delete from public.friendships where user_a = least(me, other) and user_b = greatest(me, other);
    end if;
end;
$$;

-- Friends (and friend requests) with their profiles, for the Friends page.
create function public.my_friends()
returns table (id uuid, username text, display_name text, city text, status text, incoming boolean)
language sql
stable
security definer
set search_path = ''
as $$
    select p.id, p.username, p.display_name, p.city, f.status, f.requested_by <> auth.uid()
    from public.friendships f
    join public.profiles p on p.id = case when f.user_a = auth.uid() then f.user_b else f.user_a end
    where auth.uid() in (f.user_a, f.user_b)
    order by f.status, p.username;
$$;

-- Friends see each other's collections even when a profile isn't public.
create or replace function public.is_visible(owner uuid, need_locations boolean)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select owner = auth.uid()
        or exists (
            select 1 from public.profiles p
            where p.id = owner
              and (p.profile_public or public.are_friends(owner, auth.uid()))
              and (not need_locations or p.show_locations)
        );
$$;

drop policy "profiles: public ones, and your own" on public.profiles;
create policy "profiles: public ones, friends', and your own" on public.profiles
    for select using (profile_public or id = auth.uid() or public.are_friends(id, auth.uid()));

-- ---------------------------------------------------------------- wants
create table public.wants (
    owner_id uuid not null references public.profiles (id) on delete cascade default auth.uid()
    , game text not null default 'ygo'
    , card_key text not null
    , qty int not null default 1 check (qty between 1 and 99)
    , note text not null default ''
    , created_at timestamptz not null default now()
    , primary key (owner_id, game, card_key)
);

alter table public.wants enable row level security;

create policy "wants: visible collections" on public.wants for select using (public.is_visible(owner_id, false));
create policy "wants: add your own" on public.wants for insert with check (owner_id = auth.uid());
create policy "wants: edit your own" on public.wants for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "wants: delete your own" on public.wants for delete using (owner_id = auth.uid());

-- ---------------------------------------------------------------- who has it / trade matching
-- People whose copies the caller may be pointed at: friends (all copies) and same-city public profiles
-- (only copies marked available).
create function public.who_has(card_keys text[], game text default 'ygo')
returns table (
    user_id uuid, username text, display_name text, city text, is_friend boolean,
    card_key text, qty bigint, availability text
)
language sql
stable
security definer
set search_path = ''
as $$
    with me as (select id, lower(trim(city)) as city from public.profiles where id = auth.uid()),
    people as (
        select p.id, p.username, p.display_name, p.city, public.are_friends(p.id, me.id) as is_friend
        from public.profiles p, me
        where p.id <> me.id
          and (public.are_friends(p.id, me.id) or (p.profile_public and me.city <> '' and lower(trim(p.city)) = me.city))
    )
    select pe.id, pe.username, pe.display_name, pe.city, pe.is_friend, s.card_key, sum(s.qty), s.availability
    from people pe
    join public.stacks s on s.owner_id = pe.id
    join public.groups g on g.id = s.group_id
    where s.game = who_has.game
      and s.card_key = any (card_keys)
      and g.kind <> 'lent'
      and (pe.is_friend or s.availability <> 'none')
    group by 1, 2, 3, 4, 5, 6, 8
    order by pe.is_friend desc, pe.username;
$$;

-- What you want that friends/locals offer for trade, and what they want that you offer for trade.
create function public.trade_matches(game text default 'ygo')
returns table (direction text, user_id uuid, username text, city text, is_friend boolean, card_key text, qty bigint)
language sql
stable
security definer
set search_path = ''
as $$
    with me as (select id, lower(trim(city)) as city from public.profiles where id = auth.uid()),
    people as (
        select p.id, p.username, p.city, public.are_friends(p.id, me.id) as is_friend
        from public.profiles p, me
        where p.id <> me.id
          and (public.are_friends(p.id, me.id) or (p.profile_public and me.city <> '' and lower(trim(p.city)) = me.city))
    ),
    offered as (
        select s.owner_id, s.card_key, sum(s.qty) as qty
        from public.stacks s join public.groups g on g.id = s.group_id
        where s.game = trade_matches.game and s.availability = 'trade' and g.kind <> 'lent'
        group by 1, 2
    )
    select 'they_have', pe.id, pe.username, pe.city, pe.is_friend, w.card_key, o.qty
    from public.wants w
    join offered o on o.card_key = w.card_key
    join people pe on pe.id = o.owner_id
    where w.owner_id = auth.uid() and w.game = trade_matches.game
    union all
    select 'they_want', pe.id, pe.username, pe.city, pe.is_friend, w.card_key, o.qty
    from public.wants w
    join people pe on pe.id = w.owner_id
    join offered o on o.card_key = w.card_key and o.owner_id = auth.uid()
    where w.game = trade_matches.game
    order by 1, 3;
$$;

-- ---------------------------------------------------------------- borrow / trade requests
create table public.requests (
    id uuid primary key default gen_random_uuid()
    , from_user uuid not null references public.profiles (id) on delete cascade default auth.uid()
    , to_user uuid not null references public.profiles (id) on delete cascade
    , kind text not null check (kind in ('borrow', 'trade'))
    , game text not null default 'ygo'
    , card_key text not null
    , qty int not null default 1 check (qty between 1 and 99)
    , message text not null default '' check (length(message) <= 1000)
    , reply text not null default '' check (length(reply) <= 1000)
    , status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'cancelled', 'done'))
    , created_at timestamptz not null default now()
    , updated_at timestamptz not null default now()
);

create index requests_to on public.requests (to_user, status);
create index requests_from on public.requests (from_user, status);

alter table public.requests enable row level security;

create policy "requests: yours" on public.requests for select using (auth.uid() in (from_user, to_user));
create policy "requests: ask friends or locals" on public.requests
    for insert with check (
        from_user = auth.uid() and to_user <> auth.uid() and status = 'pending'
        and exists (
            select 1 from public.profiles p, public.profiles me
            where p.id = to_user and me.id = auth.uid()
              and (public.are_friends(p.id, me.id)
                   or (p.profile_public and me.city <> '' and lower(trim(p.city)) = lower(trim(me.city))))
        )
    );

-- Status changes: the recipient accepts/declines/marks done; the sender cancels.
create function public.answer_request(request_id uuid, new_status text, reply_text text default '')
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    r public.requests;
begin
    select * into r from public.requests where id = request_id for update;
    if not found or auth.uid() not in (r.from_user, r.to_user) then raise exception 'No such request'; end if;
    if new_status = 'cancelled' and auth.uid() <> r.from_user then raise exception 'Only the sender can cancel'; end if;
    if new_status in ('accepted', 'declined', 'done') and auth.uid() <> r.to_user then
        raise exception 'Only the owner of the cards can answer';
    end if;
    if new_status not in ('accepted', 'declined', 'cancelled', 'done') then raise exception 'Bad status'; end if;
    update public.requests
    set status = new_status, reply = coalesce(nullif(reply_text, ''), reply), updated_at = now()
    where id = request_id;
end;
$$;

grant execute on function public.request_friend(text) to authenticated;
grant execute on function public.respond_friend(uuid, boolean) to authenticated;
grant execute on function public.my_friends() to authenticated;
grant execute on function public.who_has(text[], text) to authenticated;
grant execute on function public.trade_matches(text) to authenticated;
grant execute on function public.answer_request(uuid, text, text) to authenticated;
revoke execute on function public.request_friend(text), public.respond_friend(uuid, boolean), public.my_friends(),
    public.who_has(text[], text), public.trade_matches(text), public.answer_request(uuid, text, text) from public, anon;
