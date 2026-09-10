import { Injectable } from '@nestjs/common';
import { AppError, AppErrorCode } from '../common/errors/app-error';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';

/**
 * In-app notifications only.
 *
 * No email, SMS or push provider - those need external credentials the project
 * does not have, and none of them are required by the core workflow. The
 * delivery mechanism is the patient or therapist opening the app.
 */
@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(user: AuthUser, page: number, limit: number, unreadOnly = false) {
    // Scoped to the token's user id. A notification is never addressable by
    // path parameter, so there is no ownership check to forget.
    const where = {
      userId: user.userId,
      ...(unreadOnly ? { read: false } : {}),
    };

    const [rows, total, unreadCount] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({
        where: { userId: user.userId, read: false },
      }),
    ]);

    return {
      rows: rows.map((n) => ({
        id: n.id,
        type: n.type,
        title: n.title,
        message: n.message,
        read: n.read,
        payload: n.payload,
        createdAt: n.createdAt.toISOString(),
      })),
      total,
      unreadCount,
    };
  }

  async markRead(user: AuthUser, notificationId: string) {
    // updateMany with the userId in the filter means another user's id simply
    // matches nothing - it cannot be flipped by guessing an id.
    const result = await this.prisma.notification.updateMany({
      where: { id: notificationId, userId: user.userId },
      data: { read: true },
    });

    if (result.count === 0) {
      throw AppError.notFound(
        AppErrorCode.NOT_FOUND,
        'Notification not found.',
      );
    }

    return { id: notificationId, read: true };
  }

  async markAllRead(user: AuthUser) {
    const result = await this.prisma.notification.updateMany({
      where: { userId: user.userId, read: false },
      data: { read: true },
    });
    return { updated: result.count };
  }
}
