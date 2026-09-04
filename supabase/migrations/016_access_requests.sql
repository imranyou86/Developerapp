-- Gate new signups behind Developer approval instead of granting access the
-- moment someone confirms their email. New accounts land in
-- profiles.status = 'pending' and are redirected to /pending-approval
-- (enforced in middleware.ts) until a Developer approves or rejects them
-- from the Admin page's new "Access requests" section.
--
-- Run this once in the Supabase SQL editor against an EXISTING project that
-- already has migration 015_interior_design_layout.sql applied.

alter table profiles add column if not exists status text not null default 'pending' check (status in ('pending', 'approved', 'rejected'));

-- Grandfather in every account that already existed before this migration —
-- only new signups from here on start out pending.
update profiles set status = 'approved' where status = 'pending';

-- A project invite (sent by a Developer via app/projects/[id]/invite-actions.ts,
-- which calls admin.inviteUserByEmail with data: {status: 'approved'}) is
-- already a Developer-vetted grant of access, so those accounts skip the
-- pending queue entirely — only the self-service /login "Create an account"
-- flow (which sets no such metadata) lands someone in 'pending'.
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into profiles (id, email, role, status)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'role', 'owner'),
    case
      when lower(new.email) = 'imranyousuf86@gmail.com' then 'approved'
      when new.raw_user_meta_data ->> 'status' = 'approved' then 'approved'
      else 'pending'
    end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
