#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { packageRoot, resolveServerEntry } from '../lib/paths.js';

await import(pathToFileURL(resolveServerEntry(packageRoot())).href);
