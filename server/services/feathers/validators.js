import { Ajv } from '@feathersjs/schema';

/** Shared AJV instance for Feathers `validateData` hooks (service method payloads). */
export const dataValidator = new Ajv({
  coerceTypes: true,
  removeAdditional: true,
});
