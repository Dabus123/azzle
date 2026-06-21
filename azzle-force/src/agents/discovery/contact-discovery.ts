import { BaseAgent } from "../base.js";
import type { ForceContext } from "../../context.js";
import type { AgentIdentity } from "../../types.js";
import { SUBJECTS } from "../../events/subjects.js";
import { enrichEntityContacts, hasReachableContact } from "../../discovery/enrich-contacts.js";
import { ContactHintsSchema, type ContactHints } from "../../types.js";

const ID: AgentIdentity = {
  id: "contact-discovery",
  name: "Contact Discovery Agent",
  layer: "discovery",
  modelTier: "cheap",
  mission: "Find contact methods for discovered entities.",
  publishSubjects: [SUBJECTS.GRAPH_ENTITY_UPDATED],
  subscribeSubjects: [SUBJECTS.DISCOVERY_REPO_FOUND, SUBJECTS.MISSION_ASSIGNED],
};

const CONTACT_BATCH = 50;

export class ContactDiscovery extends BaseAgent {
  constructor(ctx: ForceContext) {
    super(ctx, ID);
  }

  protected async onEvent(subject: string, msg: import("../../types.js").NatsMessage): Promise<void> {
    if (!msg.entity_id) return;
    await this.discoverContacts(msg.entity_id);
  }

  protected async tick(): Promise<void> {
    const entities = await this.ctx.postgres.listEntitiesNeedingContactEnrichment(
      CONTACT_BATCH
    );
    let enriched = 0;
    for (const e of entities) {
      const added = await enrichEntityContacts(this.ctx, String(e.id), this.identity.id);
      if (added) enriched++;
      await this.discoverContacts(String(e.id));
    }
    if (entities.length > 0) {
      console.log(
        `[${this.identity.id}] enriched ${entities.length} entities (${enriched} new sendable contacts)`
      );
    }
  }

  private async discoverContacts(entityId: string): Promise<void> {
    await enrichEntityContacts(this.ctx, entityId, this.identity.id);

    const entity = await this.ctx.postgres.getEntity(entityId);
    if (!entity) return;

    const meta = entity.metadata as Record<string, unknown>;
    if (hasReachableContact(meta)) return;

    const description =
      typeof meta.description === "string"
        ? meta.description
        : typeof meta.url === "string"
          ? meta.url
          : entity.name;

    try {
      const hints = await this.llmJson<ContactHints>(
        {
          entity_id: entityId,
          name: entity.name,
          type: entity.type,
          metadata: meta,
          search_text: entity.name,
        },
        ContactHintsSchema as import("zod").ZodType<ContactHints>,
        [
          "Extract public contact hints from metadata and description only.",
          "Use prefixes: email: for emails, x: for Twitter/X handles, https:// for websites.",
          "Do not invent contacts — only include what is clearly implied by the text.",
        ].join("\n")
      );

      const existing = Array.isArray(meta.contact_methods)
        ? [...(meta.contact_methods as string[])]
        : [];
      const seen = new Set(existing);
      const added: string[] = [];
      for (const c of hints.contact_methods) {
        const s = String(c).trim();
        if (!s || seen.has(s)) continue;
        seen.add(s);
        added.push(s);
      }
      if (added.length === 0) return;

      await this.ctx.writer.write({
        agent: this.identity.id,
        type: String(entity.type),
        name: String(entity.name),
        entityId,
        metadata: {
          contact_methods: [...existing, ...added],
          contact_llm_hints: added,
        },
        embedText: hasReachableContact({ contact_methods: [...existing, ...added] })
          ? `${entity.name} contacts ${[...existing, ...added].join(" ")}`
          : undefined,
        embedCollection: hasReachableContact({ contact_methods: [...existing, ...added] })
          ? "entities"
          : undefined,
      });
    } catch (err) {
      console.warn(`[${this.identity.id}] contact LLM skip for ${entityId}:`, err);
    }
  }
}
