-- Fixes duplicate push notifications: tracks which posts have already
-- been sent to subscribers so the push-notifications lookback window
-- cannot re-notify the same post twice.
alter table public.posts
  add column if not exists notified_at timestamptz;

create index if not exists idx_posts_notified_at
  on public.posts (notified_at)
  where notified_at is null;
