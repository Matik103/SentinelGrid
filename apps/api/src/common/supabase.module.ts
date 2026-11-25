import { Global, Module } from "@nestjs/common";
import { SupabaseAdminService } from "./supabase-admin.service.js";
import { SupabaseUserFactory } from "./supabase-user.factory.js";

@Global()
@Module({
  providers: [SupabaseAdminService, SupabaseUserFactory],
  exports: [SupabaseAdminService, SupabaseUserFactory],
})
export class SupabaseModule {}
