-- Contractor/Developer can now delete a warranty request outright, not just
-- reject it (rejecting just flips status to 'rejected' and leaves the row —
-- useful for keeping a record, but there was no way to actually remove a
-- request, e.g. a duplicate or spam submission). The account that filed it
-- can still delete its own, unchanged.
drop policy if exists "warranty_item_requests_delete" on warranty_item_requests;
create policy "warranty_item_requests_delete" on warranty_item_requests
  for delete using (
    auth.uid() = requested_by
    or (
      has_project_access(project_id)
      and exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('contractor', 'developer'))
    )
  );
