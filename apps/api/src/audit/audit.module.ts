import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { OrgsModule } from "../orgs/orgs.module.js";
import { AuditController } from "./audit.controller.js";

@Module({
  imports: [AuthModule, OrgsModule],
  controllers: [AuditController],
})
export class AuditModule {}
