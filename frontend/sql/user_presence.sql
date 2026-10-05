-- Optional: route.ts ye table apne aap bana leta hai. Manually chalana ho to yahi run karein.
CREATE TABLE IF NOT EXISTS user_presence (
  user_key   text PRIMARY KEY,          -- 'staff:12' / 'dealer:5'
  kind       text NOT NULL,             -- 'staff' | 'dealer'
  user_id    text NOT NULL,
  name       text,
  role       text,
  logged_in_at timestamptz NOT NULL DEFAULT now(),
  last_seen  timestamptz NOT NULL DEFAULT now()
);
-- RLS ON + koi policy nahi = Supabase anon key se koi nahi padh/likh sakta; sirf server (DATABASE_URL) access karega.
ALTER TABLE user_presence ENABLE ROW LEVEL SECURITY;
