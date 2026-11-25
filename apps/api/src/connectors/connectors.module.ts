import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { OrgsModule } from "../orgs/orgs.module.js";
import { ConnectorsController } from "./connectors.controller.js";
import { ConnectorsService } from "./connectors.service.js";
import { EventsModule } from "../events/events.module.js";
import { ConnectorIngestController } from "./connector-ingest.controller.js";

@Module({
  imports: [AuthModule, OrgsModule, EventsModule],
  controllers: [ConnectorsController, ConnectorIngestController],
  providers: [ConnectorsService],
})
export class ConnectorsModule {}
