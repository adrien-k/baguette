export type SessionPlanTitleSource = {
  markdown?: string | null;
  ref?: number | null;
};

function atxHeadingText(line: string): string | null {
  const match = line.trim().match(/^(#{1,6})\s+(.+)$/);
  if (!match) return null;
  const text = match[2].trim();
  return text.length > 0 ? text : null;
}

/** Display title for a session plan row (first markdown heading, else first line). */
export function sessionPlanTitle(plan: SessionPlanTitleSource): string {
  const markdown = (plan.markdown ?? '').trim();
  if (markdown) {
    for (const line of markdown.split('\n')) {
      const heading = atxHeadingText(line);
      if (heading) return heading;
    }
    const first = markdown
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l.length > 0);
    if (first) return first;
  }
  if (plan.ref != null) return `Plan #${plan.ref}`;
  return 'Plan';
}
