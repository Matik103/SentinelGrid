import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { OrgsModule } from "../orgs/orgs.module.js";
import { ConnectorsController } from "./connectors.controller.js";
import { ConnectorsService } from "./connectors.service.js";

@Module({
  imports: [AuthModule, OrgsModule],
  controllers: [ConnectorsController],
  providers: [ConnectorsService],
})
export class ConnectorsModule {}
