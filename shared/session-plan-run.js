/** User message sent when clicking **Run the plan** in the UI (chat or Plan tab). */
export const RUN_PLAN_USER_MESSAGE = 'Proceed with the plan.';

/**
 * @param {number | null | undefined} planRef Session-relative plan ref when running a specific open plan.
 */
export function runPlanUserMessage(planRef) {
  if (planRef != null && Number.isFinite(planRef)) {
    return `Proceed with plan #${planRef}.`;
  }
  return RUN_PLAN_USER_MESSAGE;
}
