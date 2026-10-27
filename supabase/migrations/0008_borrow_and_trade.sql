-- Cards can be available to borrow AND trade at once ('both'), as well as one or neither.
-- Also: apply_ops() returns each applied op's id, so the app can tell whether anything else changed since its copy
-- (and skip re-downloading the collection when nothing did).
alter table public.stacks drop constraint if exists stacks_availability_check;
alter table public.stacks add constraint stacks_availability_check check (availability in ('none', 'borrow', 'trade', 'both'));
alter table public.profiles drop constraint if exists profiles_default_availability_check;
alter table public.profiles add constraint profiles_default_availability_check
    check (default_availability in ('none', 'borrow', 'trade', 'both'));
alter table public.boxes drop constraint if exists boxes_default_availability_check;
alter table public.boxes add constraint boxes_default_availability_check
    check (default_availability in ('none', 'borrow', 'trade', 'both'));
alter table public.groups drop constraint if exists groups_default_availability_check;
alter table public.groups add constraint groups_default_availability_check
    check (default_availability in ('none', 'borrow', 'trade', 'both'));

-- Trade matching counts copies marked 'trade' or 'both' (otherwise identical to 0003).
create or replace function public.trade_matches(game text default 'ygo')
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
        where s.game = trade_matches.game and s.availability in ('trade', 'both') and g.kind <> 'lent'
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

-- apply_ops() now returns the new operation's id for applied ops (otherwise identical to 0001).
create or replace function public.apply_ops(ops jsonb)
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
    new_id bigint;
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
                op ->> 'type', coalesce(op -> 'summary', '{}'), (op ->> 'created_at')::timestamptz)
        returning id into new_id;
        results := results || jsonb_build_array(jsonb_build_object('client_op_id', op -> 'client_op_id', 'status', 'applied', 'id', new_id));
    end loop;
    return results;
end;
$$;

revoke execute on function public.apply_ops(jsonb) from public, anon;
grant execute on function public.apply_ops(jsonb) to authenticated;
