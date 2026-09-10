import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

declare module 'express-serve-static-core' {
  interface Request {
    correlationId?: string;
  }
}

/**
 * Stamps every request with an id that appears in logs and in every error
 * body, so a user reporting "it failed" can be traced to exact log lines.
 */
@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.headers['x-correlation-id'];
    const id = typeof incoming === 'string' && incoming ? incoming : randomUUID();
    req.correlationId = id;
    res.setHeader('x-correlation-id', id);
    next();
  }
}
