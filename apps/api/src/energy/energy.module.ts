import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { OrgsModule } from "../orgs/orgs.module.js";
import { EventsModule } from "../events/events.module.js";
import { ConnectorsModule } from "../connectors/connectors.module.js";
import { EnergyController } from "./energy.controller.js";
import { EnergyIngestionService } from "./energy-ingestion.service.js";
import { AnomalyEvaluationService } from "./anomaly-evaluation.service.js";

@Module({
  imports: [AuthModule, OrgsModule, EventsModule, ConnectorsModule],
  controllers: [EnergyController],
  providers: [EnergyIngestionService, AnomalyEvaluationService],
  exports: [EnergyIngestionService, AnomalyEvaluationService],
})
export class EnergyModule {}
