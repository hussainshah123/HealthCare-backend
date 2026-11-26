import { Controller, Get } from '@nestjs/common';
import { Public } from '@nestjs/authentication';

@Controller()
export class AppController {
  @Public()
  @Get('health')
  health() {
    return { status: 'ok', time: new Date().toISOString() };
  }
}
