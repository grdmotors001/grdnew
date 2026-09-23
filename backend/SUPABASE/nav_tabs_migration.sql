-- Admin-configurable sidebar tabs (Menu / Tabs Settings).
-- When nav_tab has rows, the frontend sidebar is built from these instead
-- of the built-in NAV_GROUPS layout in lib/menu.js.
CREATE TABLE IF NOT EXISTS nav_tab (
    id SERIAL PRIMARY KEY,
    key VARCHAR(60) UNIQUE NOT NULL,
    label VARCHAR(120) NOT NULL,
    icon VARCHAR(40),
    position INTEGER DEFAULT 0,
    hidden BOOLEAN DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS nav_tab_item (
    id SERIAL PRIMARY KEY,
    tab_id INTEGER NOT NULL REFERENCES nav_tab(id) ON DELETE CASCADE,
    item_key VARCHAR(80) NOT NULL,
    position INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_nav_tab_item_tab_id ON nav_tab_item (tab_id);
