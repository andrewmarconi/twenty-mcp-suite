import type { RestClient } from "../twenty/restClient.js";
import type { ObjectSchema } from "./types.js";
import { fetchAllObjects as defaultLoader } from "./metadata.js";
import { driftHint } from "../twenty/errors.js";

export class SchemaCache {
  private objects: ObjectSchema[] | null = null;
  private loading: Promise<void> | null = null;

  constructor(
    private readonly rest: RestClient,
    private readonly loader: typeof defaultLoader = defaultLoader,
  ) {}

  async ensureLoaded(): Promise<void> {
    if (this.objects) return;
    if (!this.loading) {
      this.loading = this.loader(this.rest)
        .then((objs) => {
          this.objects = objs;
        })
        .finally(() => {
          this.loading = null;
        });
    }
    await this.loading;
  }

  async refresh(): Promise<number> {
    this.objects = await this.loader(this.rest);
    return this.objects.length;
  }

  list(): ObjectSchema[] {
    return this.requireLoaded();
  }

  resolve(objectName: string): ObjectSchema {
    const objects = this.requireLoaded();
    const key = objectName.toLowerCase();
    const match = objects.find(
      (o) =>
        o.namePlural.toLowerCase() === key ||
        o.nameSingular.toLowerCase() === key,
    );
    if (!match) {
      throw new Error(`Unknown object "${objectName}".${driftHint(objectName)}`);
    }
    return match;
  }

  private requireLoaded(): ObjectSchema[] {
    if (!this.objects) {
      throw new Error("Schema not loaded. Call ensureLoaded() first.");
    }
    return this.objects;
  }
}
