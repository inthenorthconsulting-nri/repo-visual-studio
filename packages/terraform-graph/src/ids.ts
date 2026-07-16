// All IDs are pure functions of (root module name, module path, Terraform-
// assigned addresses) — never of scan order or timestamps — so two parses
// of the same commit always produce byte-identical topologies. Mirrors
// @rvs/workflow-graph/src/ids.ts's approach.

const SAFE = /[^a-zA-Z0-9_.-]/g;

function sanitize(part: string): string {
  return part.replace(SAFE, "-");
}

export function rootModuleId(rootName: string): string {
  return `terraform:root:${sanitize(rootName)}`;
}

export function childModuleId(modulePath: string): string {
  return `terraform:module:${sanitize(modulePath)}`;
}

export function externalModuleId(modulePath: string): string {
  return `terraform:external-module:${sanitize(modulePath)}`;
}

function scopedAddress(modulePath: string, address: string): string {
  return modulePath ? `module.${modulePath}.${address}` : address;
}

export function resourceId(modulePath: string, resourceType: string, resourceName: string): string {
  return `terraform:resource:${scopedAddress(modulePath, `${resourceType}.${resourceName}`)}`;
}

export function dataSourceId(modulePath: string, dataType: string, dataName: string): string {
  return `terraform:data:${scopedAddress(modulePath, `${dataType}.${dataName}`)}`;
}

export function providerId(modulePath: string, providerName: string, alias?: string): string {
  const base = alias ? `${providerName}.${alias}` : providerName;
  return `terraform:provider:${scopedAddress(modulePath, base)}`;
}

export function variableId(modulePath: string, name: string): string {
  return `terraform:variable:${scopedAddress(modulePath, name)}`;
}

export function outputId(modulePath: string, name: string): string {
  return `terraform:output:${scopedAddress(modulePath, name)}`;
}

export function localId(modulePath: string, name: string): string {
  return `terraform:local:${scopedAddress(modulePath, name)}`;
}

export function backendId(backendType: string): string {
  return `terraform:backend:${sanitize(backendType)}`;
}

export function unknownReferenceId(modulePath: string, address: string): string {
  return `terraform:unknown:${sanitize(scopedAddress(modulePath, address))}`;
}

export function edgeId(type: string, source: string, target: string): string {
  return `terraform:edge:${type}:${source}->${target}`;
}
