export interface FieldSchema {
  name: string;
  type: string;
  isNullable: boolean;
  isUnique: boolean;
  isActive: boolean;
  isSystem: boolean;
}

export interface ObjectSchema {
  nameSingular: string;
  namePlural: string;
  labelSingular: string;
  labelPlural: string;
  isActive: boolean;
  isSystem: boolean;
  isSearchable: boolean;
  fields: FieldSchema[];
}
