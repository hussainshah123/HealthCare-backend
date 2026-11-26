import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CurrentUser } from '@nestjs/authentication';
import { Can } from '@nestjs/authorization';
import type { AuthUser } from '../auth/auth-user.js';
import { RolesPolicy } from '../auth/roles.policy.js';
import { MAX_UPLOAD_BYTES } from '../files/storage.service.js';
import { ReviewPrescriptionDto, UploadPrescriptionDto } from './dto/prescription.dto.js';
import { PrescriptionsService } from './prescriptions.service.js';

@Controller('prescriptions')
export class PrescriptionsController {
  constructor(private readonly prescriptions: PrescriptionsService) {}

  @Can(RolesPolicy, 'customer')
  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }))
  upload(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: UploadPrescriptionDto,
  ) {
    return this.prescriptions.upload(user.id, file, dto);
  }

  @Can(RolesPolicy, 'customer')
  @Get('me')
  listMine(@CurrentUser() user: AuthUser) {
    return this.prescriptions.listMine(user.id);
  }

  @Can.Anyone()
  @Get(':id/file')
  async file(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const { stream, mimeType } = await this.prescriptions.openFile(user, id);
    return new StreamableFile(stream, {
      type: mimeType,
      disposition: 'inline',
    });
  }

  @Can(RolesPolicy, 'pharmacy')
  @Patch(':id/review')
  review(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewPrescriptionDto,
  ) {
    return this.prescriptions.review(user, id, dto);
  }
}
