export interface RoutingRule {
  id: string;
  name: string;
  enabled: boolean;
  titleStartsWith: string;
  pathIncludes: string;
  requiredTag: string;
  propertyKey: string;
  propertyValue: string;
  destinationFolder: string;
}

export interface VaultRouterSettings {
  inboxFolder: string;
  routeOnCreate: boolean;
  autoRouteOnlyInbox: boolean;
  showMoveNotice: boolean;
  licenseKey: string;
  licenseStatus: "free" | "valid-pro" | "invalid";
  rules: RoutingRule[];
}

export interface CandidateNote {
  path: string;
  basename: string;
  filename: string;
  extension: string;
  tags: string[];
  frontmatter: Record<string, unknown>;
}

export interface RouteMatch {
  rule: RoutingRule;
  destinationFolder: string;
  destinationPath: string;
}

export interface LicenseState {
  isPro: boolean;
  email?: string;
  error?: string;
}
