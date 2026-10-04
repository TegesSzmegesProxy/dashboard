/** The shape of the proxy's generated `docs/tool-registry.json`. */
export interface ToolRegistryDocumentV3 {
  registryVersion: 'tessera.tools/v3';
  tools: RegistryToolV3[];
}

export interface RegistryToolV3 {
  id: string;
  displayName: string;
  category: string;
  /** The proxy's `ToolContextType`: one field, one uploaded file, or the request. */
  contextType: 'field' | 'file' | 'full';
  description: string;
  /** JSON Schema (2020-12) of the tool's configuration, as the proxy accepts it. */
  config: Record<string, unknown>;
}
