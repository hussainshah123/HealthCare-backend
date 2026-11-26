import { Policy } from '@nestjs/authorization';
import type { AuthUser } from './auth-user.js';

/**
 * Route-level role checks: `@Can(RolesPolicy, 'doctor')`.
 *
 * Doctors, riders and pharmacies may sign in and manage their own profile
 * while their account is PENDING approval; services check `status === ACTIVE`
 * before letting them take work (appointments, deliveries, orders).
 */
@Policy()
export class RolesPolicy {
  customer(user: AuthUser | null) {
    return user?.role === 'CUSTOMER' && user.status === 'ACTIVE';
  }

  doctor(user: AuthUser | null) {
    return user?.role === 'DOCTOR' && isWorkingAccount(user);
  }

  rider(user: AuthUser | null) {
    return user?.role === 'RIDER' && isWorkingAccount(user);
  }

  pharmacy(user: AuthUser | null) {
    return user?.role === 'PHARMACY' && isWorkingAccount(user);
  }

  admin(user: AuthUser | null) {
    return user?.role === 'ADMIN' && user.status === 'ACTIVE';
  }

  /** Customers and doctors: both sides of an appointment. */
  appointmentParticipant(user: AuthUser | null) {
    return this.customer(user) || this.doctor(user);
  }
}

function isWorkingAccount(user: AuthUser) {
  return user.status === 'ACTIVE' || user.status === 'PENDING';
}
