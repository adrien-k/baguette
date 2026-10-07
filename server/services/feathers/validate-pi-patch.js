import { BadRequest } from '@feathersjs/errors';
import { normalizePiApiKeyEnvVar } from '../../../shared/pi-api-key-env-vars.js';

/** Reject unknown pi_api_key_env_var values on user / user_repos patches. */
export async function validatePiApiKeyEnvVarPatch(context) {
  if (context.data.pi_api_key_env_var === undefined) return context;
  const raw = context.data.pi_api_key_env_var;
  if (raw === null || raw === '') {
    context.data.pi_api_key_env_var = null;
    return context;
  }
  try {
    context.data.pi_api_key_env_var = normalizePiApiKeyEnvVar(raw);
  } catch (err) {
    throw new BadRequest(err.message);
  }
  return context;
}
