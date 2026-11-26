import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { OrgsModule } from "../orgs/orgs.module.js";
import { RegistryController } from "./registry.controller.js";
import { RegistryService } from "./registry.service.js";

@Module({
  imports: [AuthModule, OrgsModule],
  controllers: [RegistryController],
  providers: [RegistryService],
})
export class RegistryModule {}
