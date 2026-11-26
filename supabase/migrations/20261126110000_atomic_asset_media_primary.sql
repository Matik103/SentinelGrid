-- Atomic primary asset-media replacement. Clears existing primary then inserts
-- the new row in one transaction so concurrent uploads cannot violate the
-- partial unique index asset_media_one_primary_per_asset.

CREATE OR REPLACE FUNCTION public.replace_asset_primary_media(
  p_organisation_id uuid,
  p_asset_id uuid,
  p_storage_path text DEFAULT NULL,
  p_external_url text DEFAULT NULL,
  p_provenance text DEFAULT 'customer_upload',
  p_asset_match_verified boolean DEFAULT false,
  p_original_filename text DEFAULT NULL,
  p_content_type text DEFAULT NULL,
  p_byte_length bigint DEFAULT NULL,
  p_manufacturer_reference text DEFAULT NULL,
  p_attribution text DEFAULT NULL,
  p_caption text DEFAULT NULL,
  p_media_kind text DEFAULT 'primary'
)
RETURNS public.asset_media
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_row public.asset_media;
BEGIN
  IF NOT (
    public.is_platform_admin()
    OR (
      public.has_org_permission(p_organisation_id, 'asset.write')
      AND EXISTS (
        SELECT 1 FROM public.assets a
        WHERE a.organisation_id = p_organisation_id
          AND a.id = p_asset_id
          AND (
            NOT public.is_facility_manager(p_organisation_id)
            OR public.has_facility_access(p_organisation_id, a.facility_id)
          )
      )
    )
  ) THEN
    RAISE EXCEPTION 'Asset write permission required' USING ERRCODE = '42501';
  END IF;

  IF p_provenance NOT IN ('customer_upload', 'manufacturer_catalogue', 'representative') THEN
    RAISE EXCEPTION 'Invalid media provenance' USING ERRCODE = '22023';
  END IF;

  IF p_media_kind NOT IN ('primary', 'detail', 'nameplate', 'manual', 'diagram') THEN
    RAISE EXCEPTION 'Invalid media kind' USING ERRCODE = '22023';
  END IF;

  IF (p_storage_path IS NULL) = (p_external_url IS NULL) THEN
    RAISE EXCEPTION 'Provide exactly one of storage_path or external_url' USING ERRCODE = '22023';
  END IF;

  IF p_external_url IS NOT NULL AND p_external_url !~ '^https://' THEN
    RAISE EXCEPTION 'External image URL must use HTTPS' USING ERRCODE = '22023';
  END IF;

  IF p_storage_path IS NOT NULL AND (
    p_storage_path ~ '^/'
    OR position('..' in p_storage_path) > 0
    OR split_part(p_storage_path, '/', 1) <> p_organisation_id::text
    OR split_part(p_storage_path, '/', 2) <> p_asset_id::text
  ) THEN
    RAISE EXCEPTION 'Invalid asset media storage path' USING ERRCODE = '22023';
  END IF;

  IF p_asset_match_verified AND p_provenance = 'representative' THEN
    RAISE EXCEPTION 'Representative images cannot be marked as exact asset matches' USING ERRCODE = '22023';
  END IF;

  UPDATE public.asset_media
  SET is_primary = false
  WHERE organisation_id = p_organisation_id
    AND asset_id = p_asset_id
    AND is_primary;

  INSERT INTO public.asset_media (
    organisation_id,
    asset_id,
    storage_path,
    external_url,
    media_kind,
    provenance,
    is_primary,
    asset_match_verified,
    original_filename,
    content_type,
    byte_length,
    manufacturer_reference,
    attribution,
    caption,
    created_by
  ) VALUES (
    p_organisation_id,
    p_asset_id,
    p_storage_path,
    p_external_url,
    p_media_kind,
    p_provenance,
    true,
    COALESCE(p_asset_match_verified, false),
    p_original_filename,
    p_content_type,
    p_byte_length,
    NULLIF(btrim(COALESCE(p_manufacturer_reference, '')), ''),
    NULLIF(btrim(COALESCE(p_attribution, '')), ''),
    NULLIF(btrim(COALESCE(p_caption, '')), ''),
    auth.uid()
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.replace_asset_primary_media(
  uuid, uuid, text, text, text, boolean, text, text, bigint, text, text, text, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.replace_asset_primary_media(
  uuid, uuid, text, text, text, boolean, text, text, bigint, text, text, text, text
) TO authenticated;
