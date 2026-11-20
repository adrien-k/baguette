import Knex from 'knex';
import { loadKnexConfig } from './lib/load-knex-config.js';

const knexConfig = await loadKnexConfig();
const db = Knex(knexConfig);

export default db;
