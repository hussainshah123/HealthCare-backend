import { Controller, Get, NotFoundException, Query } from '@nestjs/common';
import { Can } from '@nestjs/authorization';
import { Throttle } from '@nestjs/throttler';
import { Type } from 'class-transformer';
import { IsLatitude, IsLongitude } from 'class-validator';
import { GeoService } from './geo.service.js';

export class ReverseGeocodeQueryDto {
  @Type(() => Number)
  @IsLatitude()
  lat: number;

  @Type(() => Number)
  @IsLongitude()
  lng: number;
}

@Controller('geo')
export class GeoController {
  constructor(private readonly geo: GeoService) {}

  /** Any signed-in user: GPS point → `{ line1, city }` to pre-fill an address form. */
  @Can.Anyone()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Get('reverse')
  async reverse(@Query() q: ReverseGeocodeQueryDto) {
    const result = await this.geo.reverse(q.lat, q.lng);
    if (!result) throw new NotFoundException('No address found for this location');
    return result;
  }
}
