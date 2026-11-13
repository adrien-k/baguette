import { z } from 'zod';

export const todoRefSchema = z.coerce
  .number()
  .int()
  .min(1)
  .describe('Todo ref (session-relative #N from ListTodos or the Plan tab)');
