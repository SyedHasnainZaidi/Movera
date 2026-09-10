import { Controller, Get, HttpCode, HttpStatus, Param, Patch, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  CurrentUser,
  type AuthUser,
} from '../common/decorators/current-user.decorator';
import { PageDto, PaginationQueryDto } from '../common/dto/pagination.dto';
import { NotificationsService } from './notifications.service';

@ApiBearerAuth('access-token')
@ApiTags('Notifications')
@Controller({ path: 'notifications', version: '1' })
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: 'Your notifications' })
  @ApiQuery({ name: 'unreadOnly', required: false, type: Boolean })
  async list(
    @CurrentUser() user: AuthUser,
    @Query() query: PaginationQueryDto,
    @Query('unreadOnly') unreadOnly?: string,
  ) {
    const { rows, total, unreadCount } = await this.notifications.list(
      user,
      query.page,
      query.limit,
      unreadOnly === 'true',
    );
    return { ...PageDto.of(rows, total, query.page, query.limit), unreadCount };
  }

  @Patch(':id/read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark one notification read' })
  markRead(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.notifications.markRead(user, id);
  }

  @Patch('read-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark every notification read' })
  markAllRead(@CurrentUser() user: AuthUser) {
    return this.notifications.markAllRead(user);
  }
}
