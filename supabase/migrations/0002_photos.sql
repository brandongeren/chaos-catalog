-- Box and group thumbnails. Public bucket (anyone can view a photo by its URL, like the collection itself); only the
-- owner can upload or delete, and only inside their own folder (<user id>/...). Images only, at most 200 KB each
-- (the app uploads ~20-40 KB thumbnails).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', true, 204800, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do update
set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy "photos: upload to your own folder" on storage.objects
    for insert to authenticated
    with check (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "photos: delete your own" on storage.objects
    for delete to authenticated
    using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
