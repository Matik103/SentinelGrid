import { Module } from "@nestjs/common";
import { AuthModule } from "./auth/auth.module.js";
import { OrgsModule } from "./orgs/orgs.module.js";
import { EventsModule } from "./events/events.module.js";
import { EvidenceModule } from "./evidence/evidence.module.js";
import { HealthController } from "./health.controller.js";
import { SupabaseModule } from "./common/supabase.module.js";

@Module({
  imports: [SupabaseModule, AuthModule, OrgsModule, EventsModule, EvidenceModule],
  controllers: [HealthController],
})
export class AppModule {}
