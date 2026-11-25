import { Global, Module } from "@nestjs/common";
import { SupabaseAdminService } from "./supabase-admin.service.js";
import { SupabaseUserFactory } from "./supabase-user.factory.js";
import { EmailOutboxService } from "./email-outbox.service.js";
import { EmailWorkerService } from "./email-worker.service.js";

@Global()
@Module({
  providers: [SupabaseAdminService, SupabaseUserFactory, EmailOutboxService, EmailWorkerService],
  exports: [SupabaseAdminService, SupabaseUserFactory, EmailOutboxService, EmailWorkerService],
})
export class SupabaseModule {}
