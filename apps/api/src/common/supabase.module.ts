import { Global, Module } from "@nestjs/common";
import { SupabaseAdminService } from "./supabase-admin.service.js";
import { SupabaseUserFactory } from "./supabase-user.factory.js";
import { EmailOutboxService } from "./email-outbox.service.js";

@Global()
@Module({
  providers: [SupabaseAdminService, SupabaseUserFactory, EmailOutboxService],
  exports: [SupabaseAdminService, SupabaseUserFactory, EmailOutboxService],
})
export class SupabaseModule {}
