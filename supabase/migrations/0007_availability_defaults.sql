-- Default borrow/trade availability for new cards: per account, and optionally per box and per group (null = use
-- the next level up: parent groups, then the box, then the account). Cards already in the collection keep theirs.
alter table public.profiles add column default_availability text not null default 'none'
    check (default_availability in ('none', 'borrow', 'trade'));
alter table public.boxes add column default_availability text check (default_availability in ('none', 'borrow', 'trade'));
alter table public.groups add column default_availability text check (default_availability in ('none', 'borrow', 'trade'));

grant update (default_availability) on public.profiles to authenticated;

-- _put_row() now writes default_availability for boxes and groups (otherwise identical to 0006).
create or replace function public._put_row(t text, r jsonb, uid uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    if t = 'boxes' then
        insert into public.boxes as x (id, owner_id, name, notes, photo_path, sort_order, default_availability)
        values ((r ->> 'id')::uuid, uid, r ->> 'name', coalesce(r ->> 'notes', ''), r ->> 'photo_path',
                coalesce((r ->> 'sort_order')::double precision, 0), r ->> 'default_availability')
        on conflict (id) do update
        set name = excluded.name, notes = excluded.notes, photo_path = excluded.photo_path,
            sort_order = excluded.sort_order, default_availability = excluded.default_availability,
            version = x.version + 1
        where x.owner_id = uid;
    elsif t = 'groups' then
        insert into public.groups as x (
            id, owner_id, box_id, row_label, name, kind, ordered, notes, photo_path, sort_order, capacity, parent_id, position,
            default_availability
        )
        values ((r ->> 'id')::uuid, uid, (r ->> 'box_id')::uuid, nullif(r ->> 'row_label', ''), r ->> 'name',
                coalesce(r ->> 'kind', 'storage'), coalesce((r ->> 'ordered')::boolean, false),
                coalesce(r ->> 'notes', ''), r ->> 'photo_path', coalesce((r ->> 'sort_order')::double precision, 0),
                (r ->> 'capacity')::int, (r ->> 'parent_id')::uuid, (r ->> 'position')::double precision,
                r ->> 'default_availability')
        on conflict (id) do update
        set box_id = excluded.box_id, row_label = excluded.row_label, name = excluded.name, kind = excluded.kind,
            ordered = excluded.ordered, notes = excluded.notes, photo_path = excluded.photo_path,
            sort_order = excluded.sort_order, capacity = excluded.capacity, parent_id = excluded.parent_id,
            position = excluded.position, default_availability = excluded.default_availability, version = x.version + 1
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
