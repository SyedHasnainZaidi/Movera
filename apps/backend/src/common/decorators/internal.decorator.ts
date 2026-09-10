import { SetMetadata } from '@nestjs/common';

export const IS_INTERNAL_KEY = 'isInternal';

/**
 * Marks a route as part of the pose-service -> backend internal channel.
 * Such routes bypass JwtAuthGuard and are protected by InternalServiceGuard
 * (shared-secret, constant-time compared) instead.
 */
export const Internal = () => SetMetadata(IS_INTERNAL_KEY, true);
