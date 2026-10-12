-- Persist the human-edit authorization declared by each site contract. Existing
-- rows fail closed to customer_owner until an explicit contract ingestion
-- supplies a broader role list.
ALTER TABLE content_fields
  ADD COLUMN editable_by varchar(40)[] NOT NULL
    DEFAULT ARRAY['customer_owner']::varchar(40)[];

UPDATE content_fields
   SET editable_by = ARRAY['customer_owner']::varchar(40)[];

-- Preserve broader access only for fields explicitly declared editor-editable by
-- the versioned site contracts bundled with this release. Unknown/custom fields
-- intentionally remain owner-only until their contract is ingested explicitly.
UPDATE content_fields AS field
   SET editable_by = ARRAY['customer_owner', 'customer_editor']::varchar(40)[]
  FROM sites AS site
 WHERE site.tenant_id = field.tenant_id
   AND site.id = field.site_id
   AND (
     (
       site.source_path = 'sites/_starter'
       AND field.stable_id IN (
         'home.heading',
         'home.intro',
         'home.hero-image',
         'home.reserve-link',
         'home.highlights.items',
         'site.metadata',
         'home.highlights.visible',
         'home.section-order'
       )
     )
     OR (
       site.source_path = 'sites/restaurant-example'
       AND field.stable_id = 'home.marquee'
     )
     OR (
       site.source_path = 'sites/custom-portfolio-example'
       AND field.stable_id IN ('index.statement', 'projects.items')
     )
   );

ALTER TABLE content_fields
  ADD CONSTRAINT content_fields_editable_by_policy CHECK (
    cardinality(editable_by) > 0
    AND array_position(editable_by, NULL::varchar(40)) IS NULL
    AND editable_by <@ ARRAY[
      'platform_owner',
      'platform_admin',
      'staff',
      'customer_owner',
      'customer_editor'
    ]::varchar(40)[]
  );

COMMENT ON COLUMN content_fields.editable_by IS
  'Authoritative site-contract roles allowed to mutate this field through human editing paths.';
