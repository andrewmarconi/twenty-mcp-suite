import type { RestClient } from "../twenty/restClient.js";
import type { ObjectSchema, FieldSchema } from "./types.js";

interface RawField {
  name: string;
  type: string;
  isNullable?: boolean;
  isUnique?: boolean;
  isActive?: boolean;
  isSystem?: boolean;
}
interface RawObject {
  nameSingular: string;
  namePlural: string;
  labelSingular: string;
  labelPlural: string;
  isActive?: boolean;
  isSystem?: boolean;
  isSearchable?: boolean;
  fields: RawField[];
}
interface MetadataPage {
  data: RawObject[];
  pageInfo?: { hasNextPage?: boolean; endCursor?: string };
}

export async function fetchAllObjects(rest: RestClient): Promise<ObjectSchema[]> {
  const all: RawObject[] = [];
  let cursor: string | undefined;

  do {
    const page = (await rest.get("/rest/metadata/objects", {
      starting_after: cursor,
    })) as MetadataPage;
    all.push(...(page.data ?? []));
    cursor = page.pageInfo?.hasNextPage ? page.pageInfo.endCursor : undefined;
  } while (cursor);

  return all
    .filter((o) => o.isActive !== false)
    .map(normalizeObject);
}

function normalizeObject(o: RawObject): ObjectSchema {
  return {
    nameSingular: o.nameSingular,
    namePlural: o.namePlural,
    labelSingular: o.labelSingular,
    labelPlural: o.labelPlural,
    isActive: o.isActive !== false,
    isSystem: o.isSystem === true,
    isSearchable: o.isSearchable === true,
    fields: (o.fields ?? [])
      .filter((f) => f.isActive !== false)
      .map(normalizeField),
  };
}

function normalizeField(f: RawField): FieldSchema {
  return {
    name: f.name,
    type: f.type,
    isNullable: f.isNullable !== false,
    isUnique: f.isUnique === true,
    isActive: f.isActive !== false,
    isSystem: f.isSystem === true,
  };
}
