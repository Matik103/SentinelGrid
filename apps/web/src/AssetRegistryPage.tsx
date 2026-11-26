import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { addAssetExternalImage, apiGet, apiPatch, apiPost, listAssetMedia, listEnergyMeasurements, organisationId, uploadAssetImage, type AssetMediaRecord, type EnergyMeasurement } from "./api";

type Asset = {
  id: string;
  facility_id: string;
  zone_id: string | null;
  parent_asset_id?: string | null;
  criticality?: string;
  name: string;
  category: string;
  status: string;
  manufacturer?: string | null;
  model?: string | null;
  serial_number?: string | null;
  manufactured_year?: number | null;
  rated_power_kw?: number | null;
  rated_capacity_kva?: number | null;
  specifications?: Record<string, unknown> | null;
  created_at?: string;
};

type Facility = { id: string; name: string; code?: string | null };
type CategoryKey = "all" | "electrical" | "generators" | "solar" | "battery" | "hvac" | "refrigeration" | "pumps_motors" | "industrial" | "network" | "bms" | "data_center" | "transformers" | "ups" | "cooling" | "other";

const CATEGORIES: { value: Exclude<CategoryKey, "all">; label: string; icon: string; hint: string }[] = [
  { value: "electrical", label: "Electrical", icon: "⚡", hint: "Voltage class, phase, protection or panel reference" },
  { value: "generators", label: "Generator", icon: "▤", hint: "Fuel type, engine family or runtime details" },
  { value: "solar", label: "Solar", icon: "☼", hint: "Panel type, inverter model or array details" },
  { value: "battery", label: "Battery", icon: "▰", hint: "Chemistry, nominal voltage or storage capacity" },
  { value: "hvac", label: "HVAC", icon: "❄", hint: "Cooling type, refrigerant or rated capacity" },
  { value: "refrigeration", label: "Refrigeration", icon: "❄", hint: "Refrigerant, temperature range or cooling capacity" },
  { value: "pumps_motors", label: "Pumps & motors", icon: "◉", hint: "Flow, head, motor type or duty details" },
  { value: "industrial", label: "Industrial", icon: "▦", hint: "Equipment function or production line" },
  { value: "network", label: "Network", icon: "⌘", hint: "Network role, ports or rack position" },
  { value: "bms", label: "Building systems", icon: "⌂", hint: "System type or building-control reference" },
  { value: "data_center", label: "Data centre", icon: "▤", hint: "Rack position, server/GPU type, PDU or rack units" },
  { value: "transformers", label: "Transformer", icon: "ϟ", hint: "Voltage ratio, vector group, cooling class or rating" },
  { value: "ups", label: "UPS", icon: "▰", hint: "Topology, kVA rating, runtime or battery configuration" },
  { value: "cooling", label: "Cooling plant", icon: "❄", hint: "Chiller type, refrigerant, cooling capacity or COP" },
  { value: "other", label: "Other", icon: "◇", hint: "Additional equipment details" },
];

function categoryMeta(category: string) {
  return CATEGORIES.find((item) => item.value === category) ?? CATEGORIES[CATEGORIES.length - 1];
}
function display(value: unknown, suffix = "") {
  if (value === null || value === undefined || value === "") return "Not recorded";
  return `${String(value)}${suffix}`;
}
function fmtDate(value?: string) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString();
}

function EquipmentVisual({ asset, media, large = false }: { asset: Asset; media?: AssetMediaRecord; large?: boolean }) {
  const meta = categoryMeta(asset.category);
  if (media?.display_url) {
    return <div className={`equipment-visual ${large ? "large" : ""}`}>
      <img src={media.display_url} alt={`${asset.name} equipment photograph`} loading="lazy" />
      <span className="visual-source">{media.provenance === "customer_upload" ? "Customer photo" : media.provenance === "manufacturer_catalogue" ? "Manufacturer image" : "Representative image"}</span>
    </div>;
  }
  return <div className={`equipment-visual equipment-fallback ${large ? "large" : ""}`}>
    <span className="equipment-glyph">{meta.icon}</span>
    <span className="equipment-type">{meta.label}</span>
    <span className="equipment-fallback-note">Photograph not added</span>
  </div>;
}

function SpecValue({ label, value, suffix = "" }: { label: string; value: unknown; suffix?: string }) {
  return <div className="spec-value"><span>{label}</span><strong>{display(value, suffix)}</strong></div>;
}

export function AssetRegistryPage() {
  const org = organisationId();
  const [searchParams, setSearchParams] = useSearchParams();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [media, setMedia] = useState<AssetMediaRecord[]>([]);
  const [measurements, setMeasurements] = useState<EnergyMeasurement[]>([]);
  const [selectedId, setSelectedId] = useState(searchParams.get("asset") ?? "");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<CategoryKey>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mediaWarning, setMediaWarning] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [verifiedPhoto, setVerifiedPhoto] = useState(false);
  const [externalUrl, setExternalUrl] = useState("");
  const [externalSource, setExternalSource] = useState<"manufacturer_catalogue" | "representative">("manufacturer_catalogue");
  const [externalAttribution, setExternalAttribution] = useState("");
  const [manufacturerReference, setManufacturerReference] = useState("");
  const [verifiedExternal, setVerifiedExternal] = useState(false);
  const [parentAssetId, setParentAssetId] = useState("");
  const [savingRelationship, setSavingRelationship] = useState(false);

  const load = async () => {
    if (!org) { setError("Select an organisation to load its asset registry."); setLoading(false); return; }
    setLoading(true); setError(null); setMediaWarning(null);
    const [assetResult, facilityResult] = await Promise.all([
      apiGet<Asset[]>(`/v1/orgs/${org}/assets`),
      apiGet<Facility[]>(`/v1/orgs/${org}/facilities`),
    ]);
    if (assetResult.error) setError(assetResult.error.message);
    else {
      const next = assetResult.data ?? [];
      setAssets(next);
      const requestedAsset = searchParams.get("asset");
      setSelectedId((current) => current && next.some((a) => a.id === current) ? current : requestedAsset && next.some((a) => a.id === requestedAsset) ? requestedAsset : next[0]?.id ?? "");
    }
    if (facilityResult.data) setFacilities(facilityResult.data);
    if (facilityResult.error) setMediaWarning(`Facility list: ${facilityResult.error.message}`);
    try {
      const images = await listAssetMedia(org);
      setMedia(images);
    } catch (err) {
      setMedia([]);
      setMediaWarning(err instanceof Error ? err.message : String(err));
    }
    try {
      setMeasurements(await listEnergyMeasurements(org, new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()));
    } catch { setMeasurements([]); }
    setLoading(false);
  };

  useEffect(() => { void load(); }, [org]);

  const mediaByAsset = useMemo(() => {
    const result = new Map<string, AssetMediaRecord>();
    for (const item of media) {
      if (!result.has(item.asset_id) || item.is_primary) result.set(item.asset_id, item);
    }
    return result;
  }, [media]);

  const filtered = useMemo(() => assets.filter((asset) => {
    const matchCategory = category === "all" || asset.category === category;
    const search = query.trim().toLowerCase();
    const matchText = !search || [asset.name, asset.manufacturer, asset.model, asset.serial_number, asset.category]
      .some((value) => String(value ?? "").toLowerCase().includes(search));
    return matchCategory && matchText && asset.status !== "archived";
  }), [assets, category, query]);
  const selected = assets.find((asset) => asset.id === selectedId) ?? filtered[0] ?? null;
  useEffect(() => { setParentAssetId(selected?.parent_asset_id ?? ""); }, [selected?.id, selected?.parent_asset_id]);
  const selectedMedia = selected ? media.filter((item) => item.asset_id === selected.id) : [];
  const selectedMeasurements = selected ? measurements.filter((item) => item.asset_id === selected.id && item.classification === "real") : [];
  const facilityName = (id: string) => facilities.find((item) => item.id === id)?.name ?? "Facility not loaded";

  async function updateAsset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!org || !selected) return;
    const form = new FormData(event.currentTarget);
    const body = {
      name: String(form.get("name") ?? "").trim(),
      manufacturer: String(form.get("manufacturer") ?? "").trim() || null,
      model: String(form.get("model") ?? "").trim() || null,
      serial_number: String(form.get("serial_number") ?? "").trim() || null,
      manufactured_year: form.get("manufactured_year") ? Number(form.get("manufactured_year")) : null,
      rated_power_kw: form.get("rated_power_kw") ? Number(form.get("rated_power_kw")) : null,
      rated_capacity_kva: form.get("rated_capacity_kva") ? Number(form.get("rated_capacity_kva")) : null,
    };
    const result = await apiPatch<Asset>(`/v1/orgs/${org}/assets/${selected.id}`, body);
    if (result.error) {
      setMessage(result.error.message);
      return;
    }
    setMessage("Asset identity updated.");
    setShowEdit(false);
    await load();
  }

  async function createAsset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!org) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const name = String(form.get("name") ?? "").trim();
    const facilityId = String(form.get("facility_id") ?? "");
    if (!name || !facilityId) { setMessage("Asset name and facility are required."); return; }
    const detail = String(form.get("category_detail") ?? "").trim();
    const body = {
      facility_id: facilityId,
      zone_id: String(form.get("zone_id") ?? "") || null,
      parent_asset_id: String(form.get("parent_asset_id") ?? "") || null,
      criticality: String(form.get("criticality") ?? "medium"),
      name,
      category: String(form.get("category") ?? "industrial"),
      manufacturer: String(form.get("manufacturer") ?? "").trim() || null,
      model: String(form.get("model") ?? "").trim() || null,
      serial_number: String(form.get("serial_number") ?? "").trim() || null,
      manufactured_year: String(form.get("manufactured_year") ?? "") ? Number(form.get("manufactured_year")) : null,
      rated_power_kw: String(form.get("rated_power_kw") ?? "") ? Number(form.get("rated_power_kw")) : null,
      rated_capacity_kva: String(form.get("rated_capacity_kva") ?? "") ? Number(form.get("rated_capacity_kva")) : null,
      specifications: detail ? { category_detail: detail } : {},
    };
    const result = await apiPost<Asset>(`/v1/orgs/${org}/assets`, body);
    if (result.error) { setMessage(result.error.message); return; }
    setMessage("Asset registered. Add a real equipment photo to complete its visual profile.");
    setShowCreate(false);
    await load();
    if (result.data?.id) setSelectedId(result.data.id);
    formElement.reset();
  }

  async function saveParentRelationship() {
    if (!org || !selected) return;
    setSavingRelationship(true); setMessage(null);
    try {
      const result = await apiPost(`/v1/orgs/${org}/assets/${selected.id}/parent`, { parent_asset_id: parentAssetId || null });
      if (result.error) throw new Error(result.error.message);
      setMessage("Asset relationship updated. Topology and scenario views now use this explicit link.");
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally { setSavingRelationship(false); }
  }

  async function onPhotoSelected(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !org || !selected) return;
    setUploading(true); setMessage(null);
    try {
      await uploadAssetImage(org, selected.id, file, verifiedPhoto);
      setMessage("Equipment photograph uploaded and linked to this asset.");
      setVerifiedPhoto(false);
      const updated = await listAssetMedia(org);
      setMedia(updated);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally { setUploading(false); }
  }

  async function onExternalImage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!org || !selected) return;
    setUploading(true); setMessage(null);
    try {
      await addAssetExternalImage(org, selected.id, externalUrl, externalSource, externalAttribution, manufacturerReference, verifiedExternal);
      setMessage("External image reference saved with its source and verification status.");
      setExternalUrl(""); setExternalAttribution(""); setManufacturerReference(""); setVerifiedExternal(false);
      setMedia(await listAssetMedia(org));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally { setUploading(false); }
  }

  return <section className="asset-experience">
    <div className="page-heading-row">
      <div>
        <div className="eyebrow">INFRASTRUCTURE REGISTRY / VISUAL INVENTORY</div>
        <h1 className="page-title">Asset intelligence</h1>
        <p className="page-lead">A visual record of the equipment your organisation operates, monitors and protects.</p>
      </div>
      <button className="btn" type="button" onClick={() => { setShowCreate((value) => !value); setMessage(null); }}>
        {showCreate ? "Close form" : "+ Register asset"}
      </button>
    </div>

    <div className="registry-summary">
      <div><span>REGISTERED ASSETS</span><strong>{assets.filter((asset) => asset.status !== "archived").length}</strong></div>
      <div><span>WITH PHOTOGRAPHS</span><strong>{mediaByAsset.size}</strong></div>
      <div><span>ENERGY-LINKED ASSETS</span><strong>{new Set(measurements.filter((item) => item.asset_id && item.classification === "real").map((item) => item.asset_id)).size}</strong></div>
      <div><span>FACILITIES</span><strong>{facilities.length || "—"}</strong></div>
    </div>

    {showCreate && <form className="asset-create-panel" onSubmit={createAsset}>
      <div className="section-heading"><div><h2>Register equipment</h2><p>Capture identity, operational criticality and an optional same-facility parent relationship. Parent links are validated by the API.</p></div></div>
      <div className="asset-form-grid">
        <label>Asset name<input name="name" required placeholder="e.g. Main standby generator" /></label>
        <label>Facility<select name="facility_id" required defaultValue=""><option value="" disabled>Select facility</option>{facilities.map((facility) => <option key={facility.id} value={facility.id}>{facility.name}</option>)}</select></label>
        <label>Category<select name="category" defaultValue="generators">{CATEGORIES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
        <label>Criticality<select name="criticality" defaultValue="medium"><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option></select></label>
        <label>Parent asset (optional)<select name="parent_asset_id" defaultValue=""><option value="">No parent / standalone</option>{assets.filter((asset) => asset.status !== "archived").map((asset) => <option key={asset.id} value={asset.id}>{asset.name} · {facilityName(asset.facility_id)}</option>)}</select></label>
        <label>Manufacturer<input name="manufacturer" placeholder="Manufacturer" /></label>
        <label>Model<input name="model" placeholder="Model / product number" /></label>
        <label>Serial number<input name="serial_number" placeholder="Equipment serial" /></label>
        <label>Manufactured year<input name="manufactured_year" type="number" min="1900" max="2100" placeholder="YYYY" /></label>
        <label>Rated power (kW)<input name="rated_power_kw" type="number" min="0" step="0.001" placeholder="Nameplate rating" /></label>
        <label>Rated capacity (kVA)<input name="rated_capacity_kva" type="number" min="0" step="0.001" placeholder="Nameplate rating" /></label>
        <label className="wide">Additional category details<input name="category_detail" placeholder="Fuel type, refrigerant, voltage, battery chemistry, rack position…" /></label>
      </div>
      <div className="form-footer"><span>Only supplied values are saved. Unknown specifications stay blank.</span><button className="btn" type="submit">Save asset</button></div>
    </form>}

    {message && <div className="inline-notice">{message}</div>}
    {error && <div className="inline-notice error">{error}</div>}
    {mediaWarning && <div className="inline-notice warning">Visual media is not available yet: {mediaWarning}. Apply the new Supabase migration and sign in again to enable private photo storage.</div>}

    <div className="asset-workspace">
      <div className="asset-list-panel">
        <div className="asset-filter-row">
          <input aria-label="Search equipment" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search equipment, model or serial…" />
          <select aria-label="Filter category" value={category} onChange={(event) => setCategory(event.target.value as CategoryKey)}>
            <option value="all">All categories</option>{CATEGORIES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </div>
        <div className="asset-list-heading"><span>EQUIPMENT ({filtered.length})</span><span>SELECT AN ASSET</span></div>
        {loading ? <div className="empty">Loading asset inventory…</div> : filtered.length === 0 ? <div className="empty">
          {assets.length === 0 ? "No assets registered for this organisation yet." : "No equipment matches these filters."}
          {assets.length === 0 && <p>Register the first generator, meter, cooling unit, server rack or other critical asset.</p>}
        </div> : <div className="asset-card-grid">
          {filtered.map((asset) => {
            const image = mediaByAsset.get(asset.id);
            const meta = categoryMeta(asset.category);
            return <button type="button" key={asset.id} onClick={() => { setSelectedId(asset.id); const next = new URLSearchParams(searchParams); next.set("asset", asset.id); setSearchParams(next); }} className={`asset-card ${selected?.id === asset.id ? "selected" : ""}`}>
              <EquipmentVisual asset={asset} media={image} />
              <div className="asset-card-content">
                <div className="asset-card-top"><span className="asset-category">{meta.label}</span><span className={`asset-status ${asset.status === "active" ? "active" : "muted"}`}>{asset.status}</span></div>
                <strong>{asset.name}</strong>
                <span className="asset-maker">{[asset.manufacturer, asset.model].filter(Boolean).join(" · ") || "Make and model not recorded"}</span>
                <span className="asset-location">{facilityName(asset.facility_id)}</span>
              </div>
            </button>;
          })}
        </div>}
      </div>

      <aside className="asset-profile-panel">
        {selected ? <>
          <div className="asset-profile-visual"><EquipmentVisual asset={selected} media={mediaByAsset.get(selected.id)} large /></div>
          <div className="asset-profile-head">
            <div><span className="eyebrow">{categoryMeta(selected.category).label.toUpperCase()} / ASSET PROFILE</span><h2>{selected.name}</h2><p>{facilityName(selected.facility_id)}{selected.zone_id ? " · Zone assigned" : ""}</p></div>
            <div className="asset-profile-actions">
              <span className={`asset-status ${selected.status === "active" ? "active" : "muted"}`}>{selected.status}</span>
              <button type="button" className="btn secondary" onClick={() => setShowEdit((v) => !v)}>{showEdit ? "Cancel edit" : "Edit identity"}</button>
            </div>
          </div>
          {showEdit && <form className="asset-create-panel compact" onSubmit={(e) => void updateAsset(e)}>
            <div className="asset-form-grid">
              <label>Asset name<input name="name" required defaultValue={selected.name} /></label>
              <label>Manufacturer<input name="manufacturer" defaultValue={selected.manufacturer ?? ""} /></label>
              <label>Model<input name="model" defaultValue={selected.model ?? ""} /></label>
              <label>Serial number<input name="serial_number" defaultValue={selected.serial_number ?? ""} /></label>
              <label>Manufactured year<input name="manufactured_year" type="number" min="1900" max="2100" defaultValue={selected.manufactured_year ?? ""} /></label>
              <label>Rated power (kW)<input name="rated_power_kw" type="number" min="0" step="0.001" defaultValue={selected.rated_power_kw ?? ""} /></label>
              <label>Rated capacity (kVA)<input name="rated_capacity_kva" type="number" min="0" step="0.001" defaultValue={selected.rated_capacity_kva ?? ""} /></label>
            </div>
            <div className="form-footer"><span>Updates require asset.write.</span><button className="btn" type="submit">Save changes</button></div>
          </form>}
          <div className="asset-spec-grid">
            <SpecValue label="Criticality" value={selected.criticality ?? "Not recorded"} />
            <SpecValue label="Parent asset" value={assets.find((asset) => asset.id === selected.parent_asset_id)?.name ?? "Standalone"} />
            <SpecValue label="Manufacturer" value={selected.manufacturer} />
            <SpecValue label="Model" value={selected.model} />
            <SpecValue label="Manufactured" value={selected.manufactured_year} />
            <SpecValue label="Serial number" value={selected.serial_number} />
            <SpecValue label="Rated power" value={selected.rated_power_kw} suffix=" kW" />
            <SpecValue label="Rated capacity" value={selected.rated_capacity_kva} suffix=" kVA" />
          </div>
          <div className="asset-subsection">
            <div className="subsection-heading"><h3>Infrastructure relationship</h3><span>HIERARCHY / TOPOLOGY</span></div>
            <label className="relationship-field">Parent asset
              <select value={parentAssetId} onChange={(event) => setParentAssetId(event.target.value)}>
                <option value="">No parent / standalone asset</option>
                {assets.filter((asset) => asset.id !== selected.id && asset.facility_id === selected.facility_id && asset.status !== "archived").map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>)}
              </select>
            </label>
            <p className="profile-empty">Parent relationships are limited to assets in the same facility. Circular relationships are rejected by the API.</p>
            <button className="btn secondary" type="button" disabled={savingRelationship || parentAssetId === (selected.parent_asset_id ?? "")} onClick={saveParentRelationship}>{savingRelationship ? "Saving relationship…" : "Save relationship"}</button>
          </div>
          <div className="asset-subsection">
            <div className="subsection-heading"><h3>Category specifications</h3><span>NAMEPLATE / TECHNICAL DATA</span></div>
            {Object.entries(selected.specifications ?? {}).length ? <div className="spec-list">
              {Object.entries(selected.specifications ?? {}).map(([key, value]) => <SpecValue key={key} label={key.replaceAll("_", " ")} value={typeof value === "object" ? JSON.stringify(value) : value} />)}
            </div> : <div className="profile-empty">No additional specifications recorded. Add verified nameplate details to improve energy analysis.</div>}
          </div>
          <div className="asset-subsection">
            <div className="subsection-heading"><h3>Energy observations</h3><Link to={`/energy/assets/${selected.id}`}>Open asset energy profile ↗</Link></div>
            {selectedMeasurements.length ? <div className="asset-mini-metrics">
              {selectedMeasurements.slice(0, 3).map((item) => <div key={item.id}><strong>{Number(item.value).toLocaleString(undefined, { maximumFractionDigits: 2 })} <small>{item.unit}</small></strong><span>{item.metric_key.replaceAll("_", " ")}</span></div>)}
            </div> : <div className="profile-empty">No real energy readings linked to this asset yet. Measurements will appear here when an approved meter or connector sends telemetry.</div>}
          </div>
          <div className="asset-subsection">
            <div className="subsection-heading"><h3>Equipment photographs</h3><span>{selectedMedia.length} FILES</span></div>
            <label className="upload-photo-control">
              <input type="file" accept="image/jpeg,image/png,image/webp,image/avif" onChange={onPhotoSelected} disabled={uploading} />
              <span>{uploading ? "Uploading image…" : "＋ Add equipment photograph"}</span>
            </label>
            <label className="verification-check"><input type="checkbox" checked={verifiedPhoto} onChange={(event) => setVerifiedPhoto(event.target.checked)} /> I confirm this photograph shows this exact asset.</label>
            <form className="external-image-form" onSubmit={onExternalImage}>
              <label>Manufacturer / catalogue image URL<input type="url" required value={externalUrl} onChange={(event) => setExternalUrl(event.target.value)} placeholder="https://manufacturer.example/product.jpg" /></label>
              <div className="external-image-fields">
                <label>Image source<select value={externalSource} onChange={(event) => setExternalSource(event.target.value as "manufacturer_catalogue" | "representative")}><option value="manufacturer_catalogue">Manufacturer catalogue</option><option value="representative">Representative reference</option></select></label>
                <label>Model / product reference<input value={manufacturerReference} onChange={(event) => setManufacturerReference(event.target.value)} placeholder={selected.manufacturer && selected.model ? `${selected.manufacturer} ${selected.model}` : "Exact model reference"} /></label>
              </div>
              <label>Attribution / source page<input value={externalAttribution} onChange={(event) => setExternalAttribution(event.target.value)} placeholder="Manufacturer product page or image credit" /></label>
              <label className="verification-check"><input type="checkbox" checked={verifiedExternal} onChange={(event) => setVerifiedExternal(event.target.checked)} /> I verified this image matches the exact make and model.</label>
              <button className="btn secondary" type="submit" disabled={uploading}>{uploading ? "Saving…" : "Save image reference"}</button>
            </form>
            <div className="media-provenance-note">Manufacturer catalogue and representative images keep their provenance. Only mark an image as an exact match after checking the same model/reference. The customer’s actual equipment photo remains the preferred source.</div>
            {selectedMedia.length > 0 && <div className="asset-media-gallery" role="list">
              {(["primary", "detail", "nameplate", "manual", "diagram"] as const).map((kind) => {
                const group = selectedMedia.filter((item) => item.media_kind === kind);
                if (!group.length) return null;
                return <div key={kind} className="media-kind-group" role="listitem">
                  <h4>{kind.toUpperCase()}</h4>
                  <div className="asset-media-strip">{group.map((item) => <figure key={item.id} title={`${item.provenance} · ${item.asset_match_verified ? "exact match verified" : "not an exact-match claim"}`}>
                    {item.display_url ? <img src={item.display_url} alt={item.caption ?? `${kind} image`} /> : <span>Image unavailable</span>}
                    <figcaption>
                      <small>{item.is_primary ? "PRIMARY · " : ""}{item.provenance.replaceAll("_", " ")}</small>
                      {item.provenance === "representative" && <strong className="media-warn">Representative — not the customer asset</strong>}
                      {item.asset_match_verified ? <strong className="media-ok">Exact match verified</strong> : <span>Match unverified</span>}
                    </figcaption>
                  </figure>)}</div>
                </div>;
              })}
            </div>}
          </div>
          <div className="asset-profile-footer"><span>Asset ID</span><code>{selected.id}</code><span>Added {fmtDate(selected.created_at)}</span></div>
        </> : <div className="empty">Select an asset to inspect its profile.</div>}
      </aside>
    </div>
  </section>;
}
