import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { AuthModule } from "./auth/auth.module.js";
import { OrgsModule } from "./orgs/orgs.module.js";
import { EventsModule } from "./events/events.module.js";
import { EvidenceModule } from "./evidence/evidence.module.js";
import { RegistryModule } from "./registry/registry.module.js";
import { ConnectorsModule } from "./connectors/connectors.module.js";
import { EnergyModule } from "./energy/energy.module.js";
import { AuditModule } from "./audit/audit.module.js";
import { HealthController } from "./health.controller.js";
import { SupabaseModule } from "./common/supabase.module.js";
import { RateLimitMiddleware } from "./common/rate-limit.middleware.js";

@Module({
  imports: [
    SupabaseModule,
    AuthModule,
    OrgsModule,
    EventsModule,
    EvidenceModule,
    RegistryModule,
    ConnectorsModule,
    EnergyModule,
    AuditModule,
  ],
  controllers: [HealthController],
  providers: [RateLimitMiddleware],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RateLimitMiddleware).forRoutes("*");
  }
}
