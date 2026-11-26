import { Module, ValidationPipe } from '@nestjs/common';
import { APP_GUARD, APP_PIPE } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthenticationModule, type Duration } from '@nestjs/authentication';
import { AuthorizationModule } from '@nestjs/authorization';
import { createObserveModule } from '@nestjs/observe';
import { validateEnv } from './config/env.validation.js';
import { AppController } from './app.controller.js';
import { AuthModule } from './auth/auth.module.js';
import { CustomersModule } from './customers/customers.module.js';
import { MedicinesModule } from './medicines/medicines.module.js';
import { PharmaciesModule } from './pharmacies/pharmacies.module.js';
import { CartModule } from './cart/cart.module.js';
import { FilesModule } from './files/files.module.js';
import { PrescriptionsModule } from './prescriptions/prescriptions.module.js';
import { SettingsModule } from './settings/settings.module.js';
import { OrdersModule } from './orders/orders.module.js';
import { RidersModule } from './riders/riders.module.js';
import { DeliveriesModule } from './deliveries/deliveries.module.js';
import { DoctorsModule } from './doctors/doctors.module.js';
import { AppointmentsModule } from './appointments/appointments.module.js';
import { ConsultationsModule } from './consultations/consultations.module.js';
import { PaymentsModule } from './payments/payments.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { AdminModule } from './admin/admin.module.js';
import { GeoModule } from './geo/geo.module.js';
import { ContactModule } from './contact/contact.module.js';

export const { ObserveModule, ObserveInstrument } = createObserveModule();

@Module({
  imports: [
    // Distributed tracing, logs, metrics and errors. Run `npx @nestjs/observe link` to connect.
    ObserveModule.forRoot({
      appKey: process.env.OBSERVE_APP_KEY ?? 'YOUR_APP_KEY',
      appSecret: process.env.OBSERVE_APP_SECRET ?? 'YOUR_APP_SECRET',
      serviceId: 'appoitment-backend',
    }),
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    EventEmitterModule.forRoot(),
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 120 }]),
    // Authentication first: its global guard sets the user that authorization reads.
    AuthenticationModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        accessToken: {
          key: config.getOrThrow<string>('JWT_SECRET'),
          ttl: (config.get<string>('ACCESS_TOKEN_TTL') ?? '15m') as Duration,
        },
        refreshToken: {
          ttl: (config.get<string>('REFRESH_TOKEN_TTL') ?? '30d') as Duration,
          absoluteTtl: '90d',
        },
      }),
    }),
    AuthorizationModule.forRoot(),
    AuthModule,
    CustomersModule,
    MedicinesModule,
    PharmaciesModule,
    CartModule,
    FilesModule,
    PrescriptionsModule,
    SettingsModule,
    OrdersModule,
    RidersModule,
    DeliveriesModule,
    DoctorsModule,
    AppointmentsModule,
    ConsultationsModule,
    PaymentsModule,
    NotificationsModule,
    AdminModule,
    GeoModule,
    ContactModule,
  ],
  controllers: [AppController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    },
  ],
})
export class AppModule {}
