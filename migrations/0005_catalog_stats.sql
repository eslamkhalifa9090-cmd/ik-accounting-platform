-- فصول مجانية للتجربة + عداد إحصائيات يومي
ALTER TABLE materials ADD COLUMN free INTEGER NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS stats (day TEXT NOT NULL, kind TEXT NOT NULL, ref TEXT NOT NULL DEFAULT '', n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, kind, ref));
