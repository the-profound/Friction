-- One public original is stored for every inline article photo. Rendered
-- variants are requested from Supabase Storage at display time, never saved.
insert into storage.buckets (id, name, public)
values ('inline-images', 'inline-images', true)
on conflict (id) do update set public = true;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'authenticated users upload their own inline images'
  ) then
    create policy "authenticated users upload their own inline images"
      on storage.objects
      for insert
      to authenticated
      with check (
        bucket_id = 'inline-images'
        and (storage.foldername(name))[1] = 'originals'
        and (storage.foldername(name))[2] = auth.uid()::text
        and storage.extension(name) = 'jpg'
        and coalesce((metadata ->> 'mimetype'), '') = 'image/jpeg'
        and coalesce((metadata ->> 'size')::bigint, 0) between 1 and 10485760
      );
  end if;
end $$;