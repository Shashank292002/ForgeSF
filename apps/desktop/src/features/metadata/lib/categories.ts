import type { LucideIcon } from "lucide-react";
import {
  Box,
  Database,
  Globe,
  Layers,
  Lock,
  Palette,
  Plug,
  Zap,
} from "lucide-react";

export type MetadataCategoryKey =
  | "objects"
  | "apex"
  | "automation"
  | "data"
  | "access"
  | "integration"
  | "ui"
  | "other";

export interface MetadataCategoryInfo {
  key: MetadataCategoryKey;
  label: string;
  icon: LucideIcon;
  /** A CSS custom property reference — applied as an inline style. */
  color: string;
  description: string;
}

/** Turns an XML metadata type name into a friendly plural label. */
export function prettyMetadataKind(xmlName: string): string {
  const known: Record<string, string> = {
    ApexClass: "Apex Classes",
    ApexTrigger: "Apex Triggers",
    ApexPage: "Apex Pages",
    ApexComponent: "Apex Components",
    ApexTestSuite: "Apex Test Suites",
    LightningComponentBundle: "LWC Components",
    AuraDefinitionBundle: "Aura Components",
    LightningMessageChannel: "Message Channels",
    CustomObject: "Objects",
    CustomField: "Fields",
    CustomTab: "Custom Tabs",
    CompactLayout: "Compact Layouts",
    RecordType: "Record Types",
    ValidationRule: "Validation Rules",
    Flow: "Flows",
    FlowDefinition: "Flow Definitions",
    Workflow: "Workflows",
    ApprovalProcess: "Approval Processes",
    QuickAction: "Quick Actions",
    EmailTemplate: "Email Templates",
    PermissionSet: "Permission Sets",
    Profile: "Profiles",
    CustomPermission: "Custom Permissions",
    Role: "Roles",
    Group: "Groups",
    Queue: "Queues",
    CustomLabels: "Custom Labels",
    CustomMetadata: "Custom Metadata",
    GlobalValueSet: "Global Value Sets",
    StandardValueSet: "Standard Value Sets",
    StaticResource: "Static Resources",
    ContentAsset: "Content Assets",
    Report: "Reports",
    Dashboard: "Dashboards",
    ConnectedApp: "Connected Apps",
    NamedCredential: "Named Credentials",
    ExternalDataSource: "External Data Sources",
    RemoteSiteSetting: "Remote Site Settings",
    Certificate: "Certificates",
    Tab: "Tabs",
    FlexiPage: "FlexiPages",
    HomePageComponent: "Home Page Components",
    BrandingSet: "Branding Sets",
    Translation: "Translations",
    ExperienceBundle: "Experience Bundles",
    QueueRoutingConfig: "Queue Routing Configs",
    EmailServicesFunction: "Email Services",
    Document: "Documents",
    Letterhead: "Letterheads",
    AssignmentRule: "Assignment Rules",
    AutoResponseRule: "Auto-Response Rules",
    EscalationRule: "Escalation Rules",
  };
  if (known[xmlName]) return known[xmlName];

  // Fallback: insert a space before capital letters and pluralise.
  const spaced = xmlName.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  return spaced.endsWith("s") ? spaced : `${spaced}s`;
}

const CATEGORY_INFO: Record<MetadataCategoryKey, MetadataCategoryInfo> = {
  objects: {
    key: "objects",
    label: "Objects & Fields",
    icon: Database,
    color: "var(--cat-objects)",
    description: "Standard & custom objects, fields and their definitions",
  },
  apex: {
    key: "apex",
    label: "Code",
    icon: Zap,
    color: "var(--cat-apex)",
    description: "Apex classes, triggers, pages, LWC and static resources",
  },
  automation: {
    key: "automation",
    label: "Automation",
    icon: Plug,
    color: "var(--cat-automation)",
    description: "Flows, workflows, approvals, and email alerts",
  },
  data: {
    key: "data",
    label: "Data",
    icon: Box,
    color: "var(--cat-data)",
    description: "Custom metadata types, labels and value sets",
  },
  access: {
    key: "access",
    label: "Access & Users",
    icon: Lock,
    color: "var(--cat-access)",
    description: "Profiles, permission sets, roles and sharing",
  },
  integration: {
    key: "integration",
    label: "Integration",
    icon: Globe,
    color: "var(--cat-integration)",
    description: "Connected apps, named credentials and remote sites",
  },
  ui: {
    key: "ui",
    label: "User Interface",
    icon: Palette,
    color: "var(--cat-ui)",
    description: "Tabs, flexipages, themes and experience bundles",
  },
  other: {
    key: "other",
    label: "Other",
    icon: Layers,
    color: "var(--cat-other)",
    description: "Anything not covered by the categories above",
  },
};

export const CATEGORY_ORDER: MetadataCategoryKey[] = [
  "objects",
  "apex",
  "automation",
  "data",
  "access",
  "integration",
  "ui",
  "other",
];

export function metadataCategoryInfo(
  key: MetadataCategoryKey,
): MetadataCategoryInfo {
  return CATEGORY_INFO[key];
}

const CATEGORY_RULES: Array<{ key: MetadataCategoryKey; match: RegExp }> = [
  {
    key: "objects",
    match:
      /(customobject|customfield|recordtype|validationrule|listview|weblink|compactlayout|fieldset|objecttranslation|businessprocess|searchlayouts|sharingrules|index)/i,
  },
  {
    key: "apex",
    match:
      /(apexclass|apextrigger|apexcomponent|apexpage|apextestsuite|lightningcomponentbundle|lightningmessagechannel|auradefinitionbundle|staticresource|contentasset)/i,
  },
  {
    key: "automation",
    match:
      /(flow|workflow|approvalprocess|assignmentrule|autoresponserule|escalationrule|quickaction|emailtemplate|milestonetype|nametype)/i,
  },
  {
    key: "data",
    match:
      /(custommetadata|customlabels|globalvalueset|standardvalueset|valueSet|customvalueset|picklistvalue)/i,
  },
  {
    key: "access",
    match:
      /(profile|permissionset|custompermission|role|group|queue|sharingset)$/i,
  },
  {
    key: "integration",
    match:
      /(connectedapp|namedcredential|externaldatasource|remoteSiteSetting|certificate|callcenter)/i,
  },
  {
    key: "ui",
    match:
      /(flexipage|tab|homepagecomponent|homepagelayout|brandingset|theme|experiencebundle|translation|customtab)/i,
  },
];

export function categoryForType(xmlName: string): MetadataCategoryInfo {
  const matched = CATEGORY_RULES.find((rule) => rule.match.test(xmlName));
  return matched ? CATEGORY_INFO[matched.key] : CATEGORY_INFO.other;
}

/** Count of types per category, including categories with none. */
export function categoriesForTypes(
  metadata: Array<{ xmlName: string }>,
): Required<Record<MetadataCategoryKey, number>> {
  const counts = Object.fromEntries(
    CATEGORY_ORDER.map((key) => [key, 0]),
  ) as Required<Record<MetadataCategoryKey, number>>;

  for (const type of metadata) {
    const key = categoryForType(type.xmlName).key;
    counts[key] += 1;
  }

  return counts;
}
