import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { Public } from '@nestjs/authentication';
import { Can } from '@nestjs/authorization';
import { Throttle } from '@nestjs/throttler';
import { Transform } from 'class-transformer';
import { IsBoolean } from 'class-validator';
import { RolesPolicy } from '../auth/roles.policy.js';
import { PaginationQueryDto } from '../common/pagination.js';
import { IsOptionalField } from '../common/validation.js';
import { ContactService } from './contact.service.js';
import { CreateContactMessageDto } from './dto/contact.dto.js';

const toBool = ({ value }: { value: unknown }) =>
  value === 'true' ? true : value === 'false' ? false : value;

export class ListContactMessagesQueryDto extends PaginationQueryDto {
  @IsOptionalField()
  @Transform(toBool)
  @IsBoolean()
  handled?: boolean;
}

export class SetHandledDto {
  @IsBoolean()
  handled: boolean;
}

@Controller('contact')
export class ContactController {
  constructor(private readonly contact: ContactService) {}

  /**
   * Website contact form. Public. The website posts it from its own server, so
   * every visitor shares that server's IP here: the per-visitor limit lives in
   * the website, and this limit is only an overall safety net.
   */
  @Public()
  @Throttle({ default: { limit: 60, ttl: 10 * 60_000 } })
  @Post()
  create(@Body() dto: CreateContactMessageDto) {
    return this.contact.create(dto);
  }

  @Can(RolesPolicy, 'admin')
  @Get()
  list(@Query() query: ListContactMessagesQueryDto) {
    return this.contact.list(query);
  }

  @Can(RolesPolicy, 'admin')
  @Patch(':id')
  setHandled(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetHandledDto) {
    return this.contact.setHandled(id, dto.handled);
  }
}
