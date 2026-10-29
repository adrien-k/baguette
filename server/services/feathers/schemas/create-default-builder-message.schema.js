import { Type } from 'typebox';
import { getValidator } from '@feathersjs/schema';
import { dataValidator } from '../validators.js';

const askUserAnswerRowSchema = Type.Object(
  {
    question: Type.String({ minLength: 1 }),
    value: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false }
);

const createDefaultBuilderMessageDataSchema = Type.Object(
  {
    id: Type.Integer({ minimum: 1 }),
    content: Type.String({ minLength: 1 }),
    subtype: Type.Optional(Type.String({ minLength: 1 })),
    answers: Type.Optional(Type.Array(askUserAnswerRowSchema)),
    force: Type.Optional(Type.Boolean()),
    /** When set, target this session agent instead of the primary builder. */
    agent_id: Type.Optional(Type.Integer({ minimum: 1 })),
  },
  { $id: 'CreateDefaultBuilderMessageData', additionalProperties: false }
);

export const createDefaultBuilderMessageDataValidator = getValidator(
  createDefaultBuilderMessageDataSchema,
  dataValidator
);
