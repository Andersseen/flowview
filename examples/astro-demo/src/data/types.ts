/**
 * Global site metadata used for SEO, navigation, and CTAs.
 */
export interface SiteMeta {
  name: string;
  title: string;
  tagline: string;
  description: string;
  url: string;
  github: string;
  docs: string;
}

/**
 * A single footer link.
 */
export interface FooterLink {
  label: string;
  href: string;
  external?: boolean;
}

export interface FooterColumn {
  title: string;
  links: FooterLink[];
}

/**
 * Context passed to the Footer FlowView template.
 */
export interface FooterContext {
  brand: string;
  tagline: string;
  columns: FooterColumn[];
  note: string;
}

export type PackageStatus = "npm" | "crate-git" | "repo";

export interface PackageEntry {
  id: string;
  name: string;
  status: PackageStatus;
  install?: string;
  owns: string;
  whenToInstall: string;
  doesNotOwn: string;
}

export interface PackageGroup {
  id: string;
  title: string;
  summary: string;
  packages: PackageEntry[];
}

export interface PackagesContext {
  groups: PackageGroup[];
}

export interface Recipe {
  id: string;
  goal: string;
  install: string;
  note: string;
}
