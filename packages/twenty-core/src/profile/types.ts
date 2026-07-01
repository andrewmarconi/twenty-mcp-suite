/** One exposed tool in a capability profile: which primitive, under what name, with what bound args. */
export interface ProfileToolSpec {
  from: string;
  as?: string;
  bind?: Record<string, unknown>;
  description?: string;
}

/** A role-scoped capability surface built over the generic primitives. */
export interface CapabilityProfile {
  name: string;
  /** Allowed object names (nameSingular or namePlural, case-insensitive). Undefined = all objects. */
  objectScope?: string[];
  tools: ProfileToolSpec[];
}
