import { QdrantClient } from "@qdrant/js-client-rest";

const COLLECTIONS = ["repositories", "communities", "outreach", "entities"] as const;

export class QdrantStore {
  private client: QdrantClient;

  constructor(url: string) {
    this.client = new QdrantClient({ url });
  }

  async initCollections(): Promise<void> {
    for (const name of COLLECTIONS) {
      const collections = await this.client.getCollections();
      const exists = collections.collections.some((c) => c.name === name);
      if (!exists) {
        await this.client.createCollection(name, {
          vectors: { size: 384, distance: "Cosine" },
        });
      }
    }
  }

  /** Dev-friendly deterministic pseudo-embedding from text */
  embedText(text: string, dim = 384): number[] {
    const vec = new Array(dim).fill(0);
    for (let i = 0; i < text.length; i++) {
      vec[i % dim] += text.charCodeAt(i) / 255;
    }
    const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
    return vec.map((v) => v / norm);
  }

  async upsert(
    collection: typeof COLLECTIONS[number],
    entityId: string,
    text: string,
    payload: Record<string, unknown> = {}
  ): Promise<void> {
    const vector = this.embedText(text);
    await this.client.upsert(collection, {
      wait: true,
      points: [
        {
          id: entityId,
          vector,
          payload: { ...payload, entity_id: entityId, text },
        },
      ],
    });
  }

  async search(
    collection: typeof COLLECTIONS[number],
    text: string,
    limit = 5
  ): Promise<Array<{ id: string; score: number; payload: Record<string, unknown> }>> {
    const vector = this.embedText(text);
    const res = await this.client.search(collection, {
      vector,
      limit,
      with_payload: true,
    });
    return res.map((r) => ({
      id: String(r.id),
      score: r.score ?? 0,
      payload: (r.payload as Record<string, unknown>) ?? {},
    }));
  }
}
