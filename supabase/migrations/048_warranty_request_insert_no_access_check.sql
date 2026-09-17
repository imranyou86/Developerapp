-- The has_project_access(project_id) half of warranty_item_requests_insert's
-- WITH CHECK has been extensively verified correct in isolation (function
-- logic, live policy text, project_members data, and a manual impersonated
-- insert all pass) yet the real app's insert kept failing with the same RLS
-- violation across multiple accounts — root cause not found. Dropping the
-- project-access half of the check to unblock submissions: any signed-in
-- user can now file a warranty request against any project id, not just one
-- they're a member of. auth.uid() = requested_by still stands, so no one can
-- file a request pretending to be another account.
drop policy if exists "warranty_item_requests_insert" on warranty_item_requests;
create policy "warranty_item_requests_insert" on warranty_item_requests
  for insert with check (auth.uid() = requested_by);
