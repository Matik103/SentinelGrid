import { Module } from "@nestjs/common";
import { EvidenceController } from "./evidence.controller.js";
import { PayloadStorageService } from "./payload-storage.service.js";
import { AuthModule } from "../auth/auth.module.js";
import { OrgsModule } from "../orgs/orgs.module.js";

@Module({
  imports: [AuthModule, OrgsModule],
  controllers: [EvidenceController],
  providers: [PayloadStorageService],
  exports: [PayloadStorageService],
})
export class EvidenceModule {}
