import { BadRequestException, Injectable } from "@nestjs/common";
import { z } from "zod";
import type { AuthUser } from "../auth/auth.types.js";
import { OrgsService } from "../orgs/orgs.service.js";
import { SupabaseUserFactory } from "../common/supabase-user.factory.js";

const Categories = z.enum([
  "electrical",
  "generators",
  "solar",
  "battery",
  "hvac",
  "refrigeration",
  "pumps_motors",
  "industrial",
  "network",
  "bms",
  "other",
]);

const FacilitySchema = z.object({
  name: z.string().min(1).max(200),
  code: z.string().max(64).optional(),
  status: z.enum(["active", "archived"]).optional(),
});

const AssetSchema = z.object({
  facility_id: z.string().uuid(),
  name: z.string().min(1).max(200),
  category: Categories.optional(),
  status: z.enum(["active", "commissioning", "maintenance", "archived"]).optional(),
});

const DeviceSchema = z.object({
  facility_id: z.string().uuid(),
  asset_id: z.string().uuid().optional().nullable(),
  name: z.string().min(1).max(200),
  category: Categories.optional(),
  status: z.enum(["active", "offline", "maintenance", "archived"]).optional(),
});

const SensorSchema = z.object({
  facility_id: z.string().uuid(),
  device_id: z.string().uuid().optional().nullable(),
  asset_id: z.string().uuid().optional().nullable(),
  name: z.string().min(1).max(200),
  sensor_type: z.string().min(1).max(64),
  unit: z.string().max(32).optional(),
  status: z.enum(["active", "offline", "archived"]).optional(),
});

@Injectable()
export class RegistryService {
  constructor(
    private readonly orgs: OrgsService,
    private readonly users: SupabaseUserFactory,
  ) {}

  async listFacilities(user: AuthUser, organisationId: string) {
    await this.orgs.requirePermission(user, organisationId, "facility.read");
    const sb = this.users.create(user.accessToken);
    const { data, error } = await sb
      .from("facilities")
      .select("id, name, code, status, created_at")
      .eq("organisation_id", organisationId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async createFacility(user: AuthUser, organisationId: string, body: unknown) {
    const input = FacilitySchema.parse(body);
    await this.orgs.requirePermission(user, organisationId, "facility.write");
    const sb = this.users.create(user.accessToken);
    const { data, error } = await sb
      .from("facilities")
      .insert({
        organisation_id: organisationId,
        name: input.name,
        code: input.code ?? null,
        status: input.status ?? "active",
      })
      .select("id, name, code, status, created_at")
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async listAssets(user: AuthUser, organisationId: string) {
    await this.orgs.requirePermission(user, organisationId, "asset.read");
    const sb = this.users.create(user.accessToken);
    const { data, error } = await sb
      .from("assets")
      .select("id, facility_id, name, category, status, created_at")
      .eq("organisation_id", organisationId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async createAsset(user: AuthUser, organisationId: string, body: unknown) {
    const input = AssetSchema.parse(body);
    await this.orgs.requirePermission(user, organisationId, "asset.write");
    const sb = this.users.create(user.accessToken);
    const { data, error } = await sb
      .from("assets")
      .insert({
        organisation_id: organisationId,
        facility_id: input.facility_id,
        name: input.name,
        category: input.category ?? "industrial",
        status: input.status ?? "active",
      })
      .select("id, facility_id, name, category, status, created_at")
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async listDevices(user: AuthUser, organisationId: string) {
    await this.orgs.requirePermission(user, organisationId, "asset.read");
    const sb = this.users.create(user.accessToken);
    const { data, error } = await sb
      .from("devices")
      .select("id, facility_id, asset_id, name, category, status, created_at")
      .eq("organisation_id", organisationId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async createDevice(user: AuthUser, organisationId: string, body: unknown) {
    const input = DeviceSchema.parse(body);
    await this.orgs.requirePermission(user, organisationId, "asset.write");
    const sb = this.users.create(user.accessToken);
    const { data, error } = await sb
      .from("devices")
      .insert({
        organisation_id: organisationId,
        facility_id: input.facility_id,
        asset_id: input.asset_id ?? null,
        name: input.name,
        category: input.category ?? "network",
        status: input.status ?? "active",
      })
      .select("id, facility_id, asset_id, name, category, status, created_at")
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async listSensors(user: AuthUser, organisationId: string) {
    await this.orgs.requirePermission(user, organisationId, "asset.read");
    const sb = this.users.create(user.accessToken);
    const { data, error } = await sb
      .from("sensors")
      .select("id, facility_id, device_id, asset_id, name, sensor_type, unit, status, created_at")
      .eq("organisation_id", organisationId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async createSensor(user: AuthUser, organisationId: string, body: unknown) {
    const input = SensorSchema.parse(body);
    await this.orgs.requirePermission(user, organisationId, "asset.write");
    const sb = this.users.create(user.accessToken);
    const { data, error } = await sb
      .from("sensors")
      .insert({
        organisation_id: organisationId,
        facility_id: input.facility_id,
        device_id: input.device_id ?? null,
        asset_id: input.asset_id ?? null,
        name: input.name,
        sensor_type: input.sensor_type,
        unit: input.unit ?? null,
        status: input.status ?? "active",
      })
      .select("id, facility_id, device_id, asset_id, name, sensor_type, unit, status, created_at")
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }
}
