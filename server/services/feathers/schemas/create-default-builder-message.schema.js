import { Type } from 'typebox';
import { getValidator } from '@feathersjs/schema';
import { dataValidator } from '../validators.js';

const createDefaultBuilderMessageDataSchema = Type.Object(
  {
    id: Type.Integer({ minimum: 1 }),
    content: Type.String({ minLength: 1 }),
    subtype: Type.Optional(Type.String({ minLength: 1 })),
    force: Type.Optional(Type.Boolean()),
  },
  { $id: 'CreateDefaultBuilderMessageData', additionalProperties: false }
);

export const createDefaultBuilderMessageDataValidator = getValidator(
  createDefaultBuilderMessageDataSchema,
  dataValidator
);
