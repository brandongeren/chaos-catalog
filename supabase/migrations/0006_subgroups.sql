-- Sub-groups: a group can sit inside another group (any depth). In an ordered parent, sub-groups take a position
-- in the same order as its cards. A group can't be deleted while it has sub-groups (on delete restrict), and a group
-- can't end up inside itself (trigger below; the app checks this too).
alter table public.groups add column parent_id uuid references public.groups (id) on delete restrict;
alter table public.groups add column position double precision;
alter table public.groups add constraint groups_not_own_parent check (parent_id is null or parent_id <> id);
create index groups_parent on public.groups (parent_id);

create function public.groups_no_loops()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
    p uuid := new.parent_id;
    depth int := 0;
begin
    while p is not null loop
        if p = new.id then
            raise exception 'A group can''t go inside itself or one of its own sub-groups';
        end if;
        depth := depth + 1;
        if depth > 50 then
            raise exception 'Sub-groups can be at most 50 levels deep';
        end if;
        select g.parent_id into p from public.groups g where g.id = p;
    end loop;
    return new;
end;
$$;

create trigger groups_no_loops
    before insert or update of parent_id on public.groups
    for each row execute function public.groups_no_loops();

-- _put_row() now writes parent_id and position for groups (otherwise identical to 0005).
create or replace function public._put_row(t text, r jsonb, uid uuid)
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
        insert into public.groups as x (
            id, owner_id, box_id, row_label, name, kind, ordered, notes, photo_path, sort_order, capacity, parent_id, position
        )
        values ((r ->> 'id')::uuid, uid, (r ->> 'box_id')::uuid, nullif(r ->> 'row_label', ''), r ->> 'name',
                coalesce(r ->> 'kind', 'storage'), coalesce((r ->> 'ordered')::boolean, false),
                coalesce(r ->> 'notes', ''), r ->> 'photo_path', coalesce((r ->> 'sort_order')::double precision, 0),
                (r ->> 'capacity')::int, (r ->> 'parent_id')::uuid, (r ->> 'position')::double precision)
        on conflict (id) do update
        set box_id = excluded.box_id, row_label = excluded.row_label, name = excluded.name, kind = excluded.kind,
            ordered = excluded.ordered, notes = excluded.notes, photo_path = excluded.photo_path,
            sort_order = excluded.sort_order, capacity = excluded.capacity, parent_id = excluded.parent_id,
            position = excluded.position, version = x.version + 1
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
            condition, section, position, availability, lent_to_user, lent_to_name, lent_due, lent_from_group, note
        )
        values (
            (r ->> 'id')::uuid, uid, (r ->> 'group_id')::uuid, coalesce(r ->> 'game', 'ygo'), r ->> 'card_key',
            (r ->> 'custom_card_id')::uuid, (r ->> 'qty')::int, r ->> 'set_code', r ->> 'rarity', r ->> 'edition',
            coalesce(r ->> 'language', 'en'), r ->> 'condition', r ->> 'section', (r ->> 'position')::double precision,
            coalesce(r ->> 'availability', 'none'), (r ->> 'lent_to_user')::uuid, r ->> 'lent_to_name',
            (r ->> 'lent_due')::date, (r ->> 'lent_from_group')::uuid, coalesce(r ->> 'note', '')
        )
        on conflict (id) do update
        set group_id = excluded.group_id, game = excluded.game, card_key = excluded.card_key,
            custom_card_id = excluded.custom_card_id, qty = excluded.qty, set_code = excluded.set_code,
            rarity = excluded.rarity, edition = excluded.edition, language = excluded.language,
            condition = excluded.condition, section = excluded.section, position = excluded.position,
            availability = excluded.availability, lent_to_user = excluded.lent_to_user,
            lent_to_name = excluded.lent_to_name, lent_due = excluded.lent_due,
            lent_from_group = excluded.lent_from_group, note = excluded.note, version = x.version + 1, updated_at = now()
        where x.owner_id = uid;
    else
        raise exception 'unknown table %', t;
    end if;
end;
$$;

revoke execute on function public._put_row(text, jsonb, uuid) from public, anon, authenticated;
