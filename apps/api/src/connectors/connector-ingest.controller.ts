import { BadRequestException, Body, Controller, Headers, Post, UnauthorizedException } from "@nestjs/common";
import { z } from "zod";
import { ConnectorsService } from "./connectors.service.js";
import { IngestionService } from "../events/ingestion.service.js";

const ConnectorEnvelope = z.record(z.string(), z.unknown()).superRefine((value, ctx) => {
  if (!z.string().uuid().safeParse(value.connector_id).success) ctx.addIssue({ code: "custom", message: "connector_id must be a UUID" });
});

/** Connector-only endpoint. Tenant identity is resolved from the credentialed connector row. */
@Controller("connectors")
export class ConnectorIngestController {
  constructor(private readonly connectors: ConnectorsService, private readonly ingestion: IngestionService) {}

  @Post("ingest")
  async ingest(@Headers("authorization") authorization: string | undefined, @Body() body: unknown) {
    const match = /^Bearer (.+)$/i.exec(authorization ?? "");
    if (!match) throw new UnauthorizedException("Connector bearer token required");
    const parsed = ConnectorEnvelope.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.message);
    const connector = await this.connectors.authenticateConnector(String(parsed.data.connector_id), match[1]);
    const event = { ...parsed.data, organisation_id: connector.organisation_id, connector_id: connector.id };
    return this.ingestion.ingest(event, { authorisedOrganisationId: connector.organisation_id });
  }
}
