/** Trim string fields before schema validation (e.g. whitespace-only content). */
export function normalizeCreateDefaultBuilderMessageData(context) {
  const data = context.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return context;
  if (data.content != null) {
    data.content = String(data.content).trim();
  }
  if (data.subtype != null) {
    const subtype = String(data.subtype).trim();
    if (subtype) data.subtype = subtype;
    else delete data.subtype;
  }
  return context;
}
