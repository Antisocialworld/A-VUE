/**
 * UNVERIFIED PLATFORM ITEM: Fastify behind a Vercel Serverless Function handler.
 * Status: Unverified on Vercel Hobby until Phase 0 deployment proof.
 * This module is isolated so the entry point can be swapped for a native Vercel handler
 * or migrated to Railway Hobby if cold-starts or streaming limits fail.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { buildServer } from '../src/server.js';
import type { FastifyInstance } from 'fastify';

let appInstance: FastifyInstance | null = null;

async function getApp(): Promise<FastifyInstance> {
  if (!appInstance) {
    appInstance = await buildServer();
    await appInstance.ready();
  }
  return appInstance;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const app = await getApp();
  app.server.emit('request', req, res);
}

