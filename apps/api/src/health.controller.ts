import { Controller, Get } from "@nestjs/common";

@Controller("health")
export class HealthController {
  @Get()
  get() {
    return {
      status: "ok",
      phase: "0",
      ot_default: "read_only",
      service_role_in_frontend: false,
    };
  }
}
