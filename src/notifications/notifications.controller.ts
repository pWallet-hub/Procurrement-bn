import { Controller, Get, Param, Post } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../common/auth';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
export class NotificationsController {
  constructor(private n: NotificationsService) {}
  @Get() list(@CurrentUser() u: AuthUser) { return this.n.list(u.id); }
  @Post(':id/read') read(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.n.markRead(u.id, id); }
}
