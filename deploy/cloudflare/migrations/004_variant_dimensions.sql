ALTER TABLE product_variants ADD COLUMN width_cm REAL;
ALTER TABLE product_variants ADD COLUMN depth_cm REAL;
ALTER TABLE product_variants ADD COLUMN height_cm REAL;

UPDATE product_variants
SET
  width_cm = (
    SELECT p.width_cm
    FROM products p
    WHERE p.id = product_variants.product_id
  ),
  depth_cm = (
    SELECT p.depth_cm
    FROM products p
    WHERE p.id = product_variants.product_id
  ),
  height_cm = (
    SELECT p.height_cm
    FROM products p
    WHERE p.id = product_variants.product_id
  )
WHERE width_cm IS NULL AND depth_cm IS NULL AND height_cm IS NULL;
