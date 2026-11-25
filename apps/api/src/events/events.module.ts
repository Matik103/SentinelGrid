import { Module } from "@nestjs/common";
import { EventsController } from "./events.controller.js";
import { IngestionService } from "./ingestion.service.js";
import { AuthModule } from "../auth/auth.module.js";
import { EvidenceModule } from "../evidence/evidence.module.js";
import { OrgsModule } from "../orgs/orgs.module.js";

@Module({
  imports: [AuthModule, EvidenceModule, OrgsModule],
  controllers: [EventsController],
  providers: [IngestionService],
  exports: [IngestionService],
})
export class EventsModule {}
