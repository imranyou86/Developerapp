-- Lets a Developer set a friendly display name for any account, shown in
-- chat and warranty-request comments instead of their raw email. Nullable
-- — falls back to email wherever it's unset, same "optional override"
-- shape as user_tab_permissions overriding a role default.
alter table profiles add column if not exists display_name text;

-- Denormalized onto each message/comment at write time, same reasoning as
-- sender_email already is (see project_messages' table comment in
-- schema.sql): profiles_select only lets a user read their own profile
-- row, so a live join to resolve another member's name wouldn't work
-- without loosening that policy app-wide. A name change going forward only
-- affects new messages/comments, not past ones — same tradeoff
-- sender_email already has today.
alter table project_messages add column if not exists sender_name text;
alter table warranty_item_request_comments add column if not exists sender_name text;
