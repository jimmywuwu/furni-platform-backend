UPDATE product_images
SET variant_id = (
  SELECT pv.id
  FROM product_variants pv
  WHERE pv.product_id = product_images.product_id
  ORDER BY pv.id ASC
  LIMIT 1
)
WHERE variant_id IS NULL;
