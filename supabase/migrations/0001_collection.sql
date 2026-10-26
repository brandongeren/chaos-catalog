-- Phase 2: accounts (invite-only), collection tables, and apply_ops(), the single way the app changes a collection.
--
-- Security model:
-- - Sign-up requires an unused, unexpired invite code (trigger on auth.users; it fails the sign-up otherwise).
-- - Reads: Row Level Security. Owners see everything of theirs; anyone (signed in or not) can read a public
--   profile's cards, and its boxes/groups unless the owner hides locations.
-- - Writes: no insert/update/delete policies at all. Collections change only through apply_ops(), a security definer
--   function that forces owner_id = auth.uid() on every row it touches and checks row versions, so two devices can't
--   silently overwrite each other.

-- ---------------------------------------------------------------- profiles
create table public.profiles (
    id uuid primary key references auth.users (id) on delete cascade
    , username text not null unique check (username ~ '^[a-z0-9_]{3,24}$')
    , display_name text not null default ''
    , city text not null default ''
    , is_admin boolean not null default false
    , profile_public boolean not null default true
    , show_locations boolean not null default true
    , show_prices boolean not null default true
    , group_ordered_default boolean not null default false
    , created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles: public ones, and your own" on public.profiles
    for select using (profile_public or id = auth.uid());

create policy "profiles: edit your own" on public.profiles
    for update using (id = auth.uid()) with check (id = auth.uid());

-- Only these columns are editable by their owner (is_admin is set by hand in the SQL editor).
revoke update on public.profiles from anon, authenticated;
grant update (username, display_name, city, profile_public, show_locations, show_prices, group_ordered_default)
    on public.profiles to authenticated;

-- ---------------------------------------------------------------- invites
create table public.invites (
    code text primary key default replace(gen_random_uuid()::text, '-', '')
    , created_by uuid references public.profiles (id) on delete set null
    , note text not null default ''
    , used_by uuid references auth.users (id) on delete set null
    , used_at timestamptz
    , expires_at timestamptz not null default now() + interval '14 days'
    , created_at timestamptz not null default now()
);

alter table public.invites enable row level security;

create policy "invites: the ones you made" on public.invites
    for select using (created_by = auth.uid());

-- Admins create invite links; returns the new code.
create function public.create_invite(note text default '', valid_days int default 14)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_code text;
begin
    if not exists (select 1 from public.profiles where id = auth.uid() and is_admin) then
        raise exception 'Only admins can create invites';
    end if;
    insert into public.invites (created_by, note, expires_at)
    values (auth.uid(), coalesce(note, ''), now() + make_interval(days => greatest(1, least(valid_days, 365))))
    returning code into v_code;
    return v_code;
end;
$$;

-- Lets the sign-up form check a code and a username before submitting (sign-up errors from the trigger are generic).
create function public.check_signup(invite_code text, username text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
    select case
        when not exists (
            select 1 from public.invites i
            where i.code = invite_code and i.used_by is null and i.expires_at > now()
        ) then 'invalid_invite'
        when username !~ '^[a-z0-9_]{3,24}$' then 'invalid_username'
        when exists (select 1 from public.profiles p where p.username = check_signup.username) then 'username_taken'
        else 'ok'
    end;
$$;

-- ---------------------------------------------------------------- collection
create table public.boxes (
    id uuid primary key
    , owner_id uuid not null references public.profiles (id) on delete cascade
    , name text not null check (length(name) between 1 and 100)
    , notes text not null default ''
    , photo_path text
    , sort_order double precision not null default 0
    , version int not null default 1
    , created_at timestamptz not null default now()
);

create table public.groups (
    id uuid primary key
    , owner_id uuid not null references public.profiles (id) on delete cascade
    -- null = stands on its own (a binder, a deck box)
    , box_id uuid references public.boxes (id) on delete restrict
    -- optional plain label inside the box ("Row 2")
    , row_label text
    , name text not null check (length(name) between 1 and 100)
    , kind text not null default 'storage' check (kind in ('storage', 'deck', 'holding', 'lent'))
    , ordered boolean not null default false
    , notes text not null default ''
    , photo_path text
    , sort_order double precision not null default 0
    , version int not null default 1
    , created_at timestamptz not null default now()
);

create table public.custom_cards (
    id uuid primary key
    , owner_id uuid not null references public.profiles (id) on delete cascade
    , name text not null check (length(name) between 1 and 200)
    , fields jsonb not null default '{}'
    , notes text not null default ''
    , version int not null default 1
    , created_at timestamptz not null default now()
);

-- Identical copies in one place. Details are optional and travel with the copies when they move.
create table public.stacks (
    id uuid primary key
    , owner_id uuid not null references public.profiles (id) on delete cascade
    , group_id uuid not null references public.groups (id) on delete restrict
    , game text not null default 'ygo'
    -- passcode for Yu-Gi-Oh!; exactly one of card_key / custom_card_id
    , card_key text
    , custom_card_id uuid references public.custom_cards (id) on delete restrict
    , qty int not null check (qty > 0)
    , set_code text
    , rarity text
    , edition text
    , language text not null default 'en'
    , condition text check (condition in ('NM', 'LP', 'MP', 'HP', 'Damaged'))
    -- deck groups only
    , section text check (section in ('main', 'extra', 'side'))
    -- ordered groups only
    , position double precision
    , availability text not null default 'none' check (availability in ('none', 'borrow', 'trade'))
    , lent_to_user uuid references public.profiles (id) on delete set null
    , lent_to_name text
    , lent_due date
    , lent_from_group uuid references public.groups (id) on delete set null
    , version int not null default 1
    , created_at timestamptz not null default now()
    , updated_at timestamptz not null default now()
    , check ((card_key is null) <> (custom_card_id is null))
);

create index stacks_owner_card on public.stacks (owner_id, card_key);
create index stacks_group on public.stacks (group_id);
create index groups_owner on public.groups (owner_id);
create index boxes_owner on public.boxes (owner_id);
create index custom_cards_owner on public.custom_cards (owner_id);

-- History, and the record that makes retries safe: one row per applied change.
create table public.operations (
    id bigint generated always as identity primary key
    , owner_id uuid not null references public.profiles (id) on delete cascade
    , client_op_id uuid not null
    , batch_id uuid
    , device text not null default ''
    , type text not null
    -- what happened, in words and card details, for the history view and "re-add from history"
    , summary jsonb not null default '{}'
    , client_created_at timestamptz
    , created_at timestamptz not null default now()
    , unique (owner_id, client_op_id)
);

create index operations_owner_recent on public.operations (owner_id, id desc);

alter table public.boxes enable row level security;
alter table public.groups enable row level security;
alter table public.custom_cards enable row level security;
alter table public.stacks enable row level security;
alter table public.operations enable row level security;

-- A collection is readable by its owner, and by everyone when the owner's profile is public.
create function public.is_visible(owner uuid, need_locations boolean)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select owner = auth.uid()
        or exists (
            select 1 from public.profiles p
            where p.id = owner and p.profile_public and (not need_locations or p.show_locations)
        );
$$;

create policy "boxes: visible collections" on public.boxes for select using (public.is_visible(owner_id, true));
create policy "groups: visible collections" on public.groups for select using (public.is_visible(owner_id, true));
create policy "custom cards: visible collections" on public.custom_cards
    for select using (public.is_visible(owner_id, false));
create policy "stacks: visible collections" on public.stacks for select using (public.is_visible(owner_id, false));
create policy "operations: your own" on public.operations for select using (owner_id = auth.uid());

-- ---------------------------------------------------------------- sign-up
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_code text := new.raw_user_meta_data ->> 'invite_code';
    v_username text := lower(coalesce(new.raw_user_meta_data ->> 'username', ''));
begin
    update public.invites
    set used_by = new.id, used_at = now()
    where code = v_code and used_by is null and expires_at > now();
    if not found then
        raise exception 'A valid invite code is required to sign up';
    end if;

    insert into public.profiles (id, username, display_name)
    values (new.id, v_username, coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), v_username));

    -- Everyone starts with one in-between area for cards that are out of storage.
    insert into public.groups (id, owner_id, name, kind)
    values (gen_random_uuid(), new.id, 'Unsorted', 'holding');
    return new;
end;
$$;

create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------- apply_ops
-- ops: [{ client_op_id, batch_id?, device?, type, summary, created_at?,
--         expect: [{ t, id, v }],      -- every row touched, at the version the client last saw (0 = new)
--         put: [{ t, row }],           -- full rows to insert or replace
--         del: [{ t, id }] }]
-- Returns [{ client_op_id, status: applied | duplicate | rejected, reason? }]. Stops at the first rejection, since
-- later changes in the list may depend on it. Each applied op is one row in operations.

create function public._put_row(t text, r jsonb, uid uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    if t = 'boxes' then
        insert into public.boxes as x (id, owner_id, name, notes, photo_path, sort_order)
        values ((r ->> 'id')::uuid, uid, r ->> 'name', coalesce(r ->> 'notes', ''), r ->> 'photo_path',
                coalesce((r ->> 'sort_order')::double precision, 0))
        on conflict (id) do update
        set name = excluded.name, notes = excluded.notes, photo_path = excluded.photo_path,
            sort_order = excluded.sort_order, version = x.version + 1
        where x.owner_id = uid;
    elsif t = 'groups' then
        insert into public.groups as x (id, owner_id, box_id, row_label, name, kind, ordered, notes, photo_path, sort_order)
        values ((r ->> 'id')::uuid, uid, (r ->> 'box_id')::uuid, nullif(r ->> 'row_label', ''), r ->> 'name',
                coalesce(r ->> 'kind', 'storage'), coalesce((r ->> 'ordered')::boolean, false),
                coalesce(r ->> 'notes', ''), r ->> 'photo_path', coalesce((r ->> 'sort_order')::double precision, 0))
        on conflict (id) do update
        set box_id = excluded.box_id, row_label = excluded.row_label, name = excluded.name, kind = excluded.kind,
            ordered = excluded.ordered, notes = excluded.notes, photo_path = excluded.photo_path,
            sort_order = excluded.sort_order, version = x.version + 1
        where x.owner_id = uid;
    elsif t = 'custom_cards' then
        insert into public.custom_cards as x (id, owner_id, name, fields, notes)
        values ((r ->> 'id')::uuid, uid, r ->> 'name', coalesce(r -> 'fields', '{}'), coalesce(r ->> 'notes', ''))
        on conflict (id) do update
        set name = excluded.name, fields = excluded.fields, notes = excluded.notes, version = x.version + 1
        where x.owner_id = uid;
    elsif t = 'stacks' then
        insert into public.stacks as x (
            id, owner_id, group_id, game, card_key, custom_card_id, qty, set_code, rarity, edition, language,
            condition, section, position, availability, lent_to_user, lent_to_name, lent_due, lent_from_group
        )
        values (
            (r ->> 'id')::uuid, uid, (r ->> 'group_id')::uuid, coalesce(r ->> 'game', 'ygo'), r ->> 'card_key',
            (r ->> 'custom_card_id')::uuid, (r ->> 'qty')::int, r ->> 'set_code', r ->> 'rarity', r ->> 'edition',
            coalesce(r ->> 'language', 'en'), r ->> 'condition', r ->> 'section', (r ->> 'position')::double precision,
            coalesce(r ->> 'availability', 'none'), (r ->> 'lent_to_user')::uuid, r ->> 'lent_to_name',
            (r ->> 'lent_due')::date, (r ->> 'lent_from_group')::uuid
        )
        on conflict (id) do update
        set group_id = excluded.group_id, game = excluded.game, card_key = excluded.card_key,
            custom_card_id = excluded.custom_card_id, qty = excluded.qty, set_code = excluded.set_code,
            rarity = excluded.rarity, edition = excluded.edition, language = excluded.language,
            condition = excluded.condition, section = excluded.section, position = excluded.position,
            availability = excluded.availability, lent_to_user = excluded.lent_to_user,
            lent_to_name = excluded.lent_to_name, lent_due = excluded.lent_due,
            lent_from_group = excluded.lent_from_group, version = x.version + 1, updated_at = now()
        where x.owner_id = uid;
    else
        raise exception 'unknown table %', t;
    end if;
end;
$$;

create function public.apply_ops(ops jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    uid uuid := auth.uid();
    op jsonb;
    e jsonb;
    t text;
    cur int;
    results jsonb := '[]';
    covered text[];
    reason text;
begin
    if uid is null then
        raise exception 'Not signed in';
    end if;
    if jsonb_typeof(ops) <> 'array' then
        raise exception 'ops must be an array';
    end if;

    for op in select value from jsonb_array_elements(ops) loop
        if exists (
            select 1 from public.operations where owner_id = uid and client_op_id = (op ->> 'client_op_id')::uuid
        ) then
            results := results || jsonb_build_array(jsonb_build_object('client_op_id', op -> 'client_op_id', 'status', 'duplicate'));
            continue;
        end if;

        -- Preconditions: every touched row is still at the version the client saw.
        reason := null;
        covered := '{}';
        for e in select value from jsonb_array_elements(coalesce(op -> 'expect', '[]')) loop
            t := e ->> 't';
            if t not in ('boxes', 'groups', 'custom_cards', 'stacks') then
                raise exception 'unknown table %', t;
            end if;
            execute format('select version from public.%I where id = $1 and owner_id = $2', t)
                into cur using (e ->> 'id')::uuid, uid;
            if coalesce(cur, 0) <> (e ->> 'v')::int then
                reason := format('%s %s is at version %s, expected %s', t, e ->> 'id', coalesce(cur, 0), e ->> 'v');
                exit;
            end if;
            covered := covered || (t || ':' || (e ->> 'id'));
        end loop;
        if reason is null and exists (
            select 1 from jsonb_array_elements(coalesce(op -> 'put', '[]') ) x
            where not ((x ->> 't') || ':' || (x -> 'row' ->> 'id')) = any (covered)
            union all
            select 1 from jsonb_array_elements(coalesce(op -> 'del', '[]')) x
            where not ((x ->> 't') || ':' || (x ->> 'id')) = any (covered)
        ) then
            reason := 'every changed row must be listed in expect';
        end if;
        if reason is not null then
            results := results || jsonb_build_array(jsonb_build_object(
                'client_op_id', op -> 'client_op_id', 'status', 'rejected', 'reason', reason));
            return results;
        end if;

        -- Deletes children first, puts parents first, so foreign keys hold inside one op.
        foreach t in array array['stacks', 'groups', 'custom_cards', 'boxes'] loop
            execute format(
                'delete from public.%I where owner_id = $1 and id in '
                '(select (x ->> ''id'')::uuid from jsonb_array_elements($2) x where x ->> ''t'' = $3)', t)
                using uid, coalesce(op -> 'del', '[]'), t;
        end loop;
        foreach t in array array['boxes', 'custom_cards', 'groups', 'stacks'] loop
            perform public._put_row(t, x -> 'row', uid)
            from jsonb_array_elements(coalesce(op -> 'put', '[]')) x
            where x ->> 't' = t;
        end loop;

        insert into public.operations (owner_id, client_op_id, batch_id, device, type, summary, client_created_at)
        values (uid, (op ->> 'client_op_id')::uuid, (op ->> 'batch_id')::uuid, coalesce(op ->> 'device', ''),
                op ->> 'type', coalesce(op -> 'summary', '{}'), (op ->> 'created_at')::timestamptz);
        results := results || jsonb_build_array(jsonb_build_object('client_op_id', op -> 'client_op_id', 'status', 'applied'));
    end loop;
    return results;
end;
$$;

revoke execute on function public._put_row(text, jsonb, uuid) from public, anon, authenticated;
revoke execute on function public.apply_ops(jsonb) from public, anon;
grant execute on function public.apply_ops(jsonb) to authenticated;
revoke execute on function public.create_invite(text, int) from public, anon;
grant execute on function public.create_invite(text, int) to authenticated;
grant execute on function public.check_signup(text, text) to anon, authenticated;
