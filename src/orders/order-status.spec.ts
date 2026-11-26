import { canTransition } from './order-status.js';

describe('order status transitions', () => {
  it('lets the pharmacy walk an order to ready-for-pickup', () => {
    expect(canTransition('PENDING', 'CONFIRMED', 'PHARMACY')).toBe(true);
    expect(canTransition('CONFIRMED', 'PREPARING', 'PHARMACY')).toBe(true);
    expect(canTransition('PREPARING', 'READY_FOR_PICKUP', 'PHARMACY')).toBe(true);
  });

  it('does not let anyone skip ahead', () => {
    expect(canTransition('PENDING', 'READY_FOR_PICKUP', 'PHARMACY')).toBe(false);
    expect(canTransition('PENDING', 'DELIVERED', 'ADMIN')).toBe(false);
    expect(canTransition('RIDER_ASSIGNED', 'DELIVERED', 'RIDER')).toBe(false);
  });

  it('keeps delivery steps for the rider', () => {
    expect(canTransition('READY_FOR_PICKUP', 'RIDER_ASSIGNED', 'RIDER')).toBe(true);
    expect(canTransition('RIDER_ASSIGNED', 'PICKED_UP', 'RIDER')).toBe(true);
    expect(canTransition('PICKED_UP', 'ON_THE_WAY', 'RIDER')).toBe(true);
    expect(canTransition('ON_THE_WAY', 'DELIVERED', 'RIDER')).toBe(true);
    expect(canTransition('RIDER_ASSIGNED', 'PICKED_UP', 'PHARMACY')).toBe(false);
  });

  it('lets customers cancel only before pickup', () => {
    expect(canTransition('PREPARING', 'CANCELLED', 'CUSTOMER')).toBe(true);
    expect(canTransition('RIDER_ASSIGNED', 'CANCELLED', 'CUSTOMER')).toBe(true);
    expect(canTransition('PICKED_UP', 'CANCELLED', 'CUSTOMER')).toBe(false);
    expect(canTransition('DELIVERED', 'CANCELLED', 'CUSTOMER')).toBe(false);
  });

  it('treats delivered, cancelled and returned as final except admin returns', () => {
    expect(canTransition('DELIVERED', 'RETURNED', 'ADMIN')).toBe(true);
    expect(canTransition('CANCELLED', 'PENDING', 'ADMIN')).toBe(false);
    expect(canTransition('RETURNED', 'DELIVERED', 'ADMIN')).toBe(false);
  });
});
