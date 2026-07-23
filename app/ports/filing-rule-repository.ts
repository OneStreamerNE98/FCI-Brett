import type {
  FilingRulePatchValues,
  FilingRuleRecord,
  FilingRuleValues,
} from "../domain/filing-rule";

export type FilingRuleCreation = Readonly<{
  id: string;
  values: FilingRuleValues;
  createdBy: string;
  createdAt: number;
}>;

export type FilingRuleUpdate = Readonly<{
  id: string;
  values: FilingRulePatchValues;
  updatedAt: number;
}>;

export interface FilingRuleRepository {
  list(): Promise<FilingRuleRecord[]>;
  create(input: FilingRuleCreation): Promise<void>;
  update(input: FilingRuleUpdate): Promise<boolean>;
  delete(id: string): Promise<boolean>;
}
