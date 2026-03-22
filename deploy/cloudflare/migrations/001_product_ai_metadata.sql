ALTER TABLE products ADD COLUMN width_cm REAL;
ALTER TABLE products ADD COLUMN depth_cm REAL;
ALTER TABLE products ADD COLUMN height_cm REAL;
ALTER TABLE products ADD COLUMN ai_primary_title TEXT;
ALTER TABLE products ADD COLUMN ai_primary_description TEXT;
ALTER TABLE products ADD COLUMN ai_metadata_json TEXT;

CREATE TABLE IF NOT EXISTS product_tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    tag_group TEXT NOT NULL,
    tag_value TEXT NOT NULL,
    score REAL,
    source TEXT NOT NULL DEFAULT 'ai',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (product_id, tag_group, tag_value),
    FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE INDEX IF NOT EXISTS idx_product_tags_product_id ON product_tags(product_id);
CREATE INDEX IF NOT EXISTS idx_product_tags_group_value ON product_tags(tag_group, tag_value);
