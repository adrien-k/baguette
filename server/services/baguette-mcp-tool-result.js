export function ok(data) {
  return { content: [{ type: 'text', text: JSON.stringify({ ok: true, ...data }, null, 2) }] };
}

export function fail(message) {
  return {
    content: [{ type: 'text', text: JSON.stringify({ ok: false, error: message }, null, 2) }],
  };
}
