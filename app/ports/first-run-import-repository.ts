export type FirstRunImportStoredClient = Readonly<{
  id: string;
  clientCode: string;
  sourceClientCodes: readonly string[];
  name: string;
  industry: string | null;
  emails: readonly string[];
  phones: readonly string[];
  addresses: readonly string[];
  addressDigests: readonly string[];
}>;

export type FirstRunImportStoredProject = Readonly<{
  id: string;
  clientId: string;
  name: string;
  site: string | null;
}>;

export type FirstRunImportSnapshot = Readonly<{
  clients: readonly FirstRunImportStoredClient[];
  projects: readonly FirstRunImportStoredProject[];
}>;

export type FirstRunImportProvenance = Readonly<{
  sourceKind: "spreadsheet" | "csv";
  sourceRow: number;
  sourceClientCode?: string | null;
  sourceAddressDigest?: string | null;
}>;

export type FirstRunImportClientCreate = Readonly<{
  id: string;
  clientCode: string;
  name: string;
  status: string;
  industry: string | null;
  duplicateAddress: string | null;
  primaryContact: Readonly<{
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    role: string;
  }> | null;
  activityId: string;
  actor: string;
  createdAt: number;
  provenance: FirstRunImportProvenance;
}>;

export type FirstRunImportProjectCreate = Readonly<{
  id: string;
  projectNumber: string;
  clientId: string;
  name: string;
  status: string;
  site: string | null;
  projectManagerId: string;
  estimatedValue: number | null;
  flooringCategory: string | null;
  squareFeet: number | null;
  contractValue: number | null;
  segment: "commercial" | "residential" | null;
  activityId: string;
  actor: string;
  createdAt: number;
  provenance: FirstRunImportProvenance;
}>;

export type FirstRunImportCreateResult = Readonly<{
  id: string | null;
  identifier: string | null;
  outcome: "created" | "duplicate" | "missing-client";
}>;

export interface FirstRunImportRepository {
  snapshot(): Promise<FirstRunImportSnapshot>;
  createClients(
    rows: readonly FirstRunImportClientCreate[],
  ): Promise<readonly FirstRunImportCreateResult[]>;
  createProjects(
    rows: readonly FirstRunImportProjectCreate[],
  ): Promise<readonly FirstRunImportCreateResult[]>;
}
