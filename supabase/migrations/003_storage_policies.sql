-- Private practice audio access is mediated by the API service role. No browser
-- client receives a public bucket URL or unrestricted object listing.
drop policy if exists "practice audio private" on storage.objects;
create policy "practice audio private" on storage.objects
  for all using (bucket_id = 'practice-audio' and auth.role() = 'service_role')
  with check (bucket_id = 'practice-audio' and auth.role() = 'service_role');
