import { Body, Controller, Get, Headers, HttpCode, Post, Query, Req, type RawBodyRequest } from '@nestjs/common';
import { CurrentUser, Public } from '@nestjs/authentication';
import { Can } from '@nestjs/authorization';
import type { Request } from 'express';
import type { AuthUser } from '../auth/auth-user.js';
import { RolesPolicy } from '../auth/roles.policy.js';
import { PaginationQueryDto } from '../common/pagination.js';
import { PaymentWebhookDto } from './dto/payment.dto.js';
import { PaymentsService } from './payments.service.js';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Can(RolesPolicy, 'customer')
  @Get('me')
  listMine(@CurrentUser() user: AuthUser, @Query() query: PaginationQueryDto) {
    return this.payments.listMine(user.id, query);
  }

  @Public()
  @Post('webhook')
  @HttpCode(200)
  webhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-signature') signature: string | undefined,
    @Body() dto: PaymentWebhookDto,
  ) {
    return this.payments.handleWebhook(req.rawBody, signature, dto);
  }
}
