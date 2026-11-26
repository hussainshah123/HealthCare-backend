import { Injectable } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsIn } from 'class-validator';
import { toMoney } from '../common/money.js';
import { IsOptionalField } from '../common/validation.js';
import { platformOffsetMinutes } from '../doctors/slots.js';
import { PrismaService } from '../prisma/prisma.service.js';

export const ANALYTICS_RANGES = [7, 30, 90] as const;

export class AnalyticsQueryDto {
  @IsOptionalField()
  @Type(() => Number)
  @IsIn(ANALYTICS_RANGES)
  days: (typeof ANALYTICS_RANGES)[number] = 30;
}

export interface AnalyticsPoint {
  /** Local calendar day, YYYY-MM-DD in the platform time zone. */
  date: string;
  orders: number;
  /** Sum of order totals (cancelled/returned excluded). */
  orderValue: number;
  newUsers: number;
  appointments: number;
  deliveries: number;
}

export interface AnalyticsTotals {
  orders: number;
  orderValue: number;
  newUsers: number;
  appointments: number;
  deliveries: number;
}

export interface AdminAnalyticsDto {
  days: number;
  from: string;
  to: string;
  series: AnalyticsPoint[];
  totals: AnalyticsTotals;
  /** Same metrics for the equally long period just before, for change arrows. */
  previous: AnalyticsTotals;
  ordersByStatus: { status: string; count: number }[];
  usersByRole: { role: string; count: number }[];
  topPharmacies: { id: string; name: string; orders: number; orderValue: number }[];
  topMedicines: { name: string; quantity: number }[];
  live: { activeDeliveries: number; ridersOnline: number; pendingApprovals: number; newMessages: number };
}

const DAY_MS = 86_400_000;
const NOT_SOLD = ['CANCELLED', 'RETURNED'];

/**
 * Time-series and breakdowns for the admin overview. Rows are fetched for the
 * window and bucketed per local day in code, which keeps the queries simple and
 * database-agnostic; fine for an admin dashboard's volume.
 */
@Injectable()
export class AdminAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async analytics(days: number): Promise<AdminAnalyticsDto> {
    const offsetMs = platformOffsetMinutes() * 60_000;
    // Start of "today" in local time, expressed in UTC.
    const now = Date.now();
    const todayLocalStart = Math.floor((now + offsetMs) / DAY_MS) * DAY_MS - offsetMs;
    const from = new Date(todayLocalStart - (days - 1) * DAY_MS);
    const prevFrom = new Date(from.getTime() - days * DAY_MS);
    const to = new Date(now);
    const dayKey = (d: Date) => new Date(d.getTime() + offsetMs).toISOString().slice(0, 10);

    const [orders, users, appointments, deliveries, ordersByStatus, usersByRole, items, live] = await Promise.all([
      this.prisma.order.findMany({
        where: { createdAt: { gte: prevFrom } },
        select: { createdAt: true, total: true, status: true, pharmacyId: true },
      }),
      this.prisma.user.findMany({ where: { createdAt: { gte: prevFrom } }, select: { createdAt: true } }),
      this.prisma.appointment.findMany({ where: { createdAt: { gte: prevFrom } }, select: { createdAt: true } }),
      this.prisma.delivery.findMany({
        where: { status: 'DELIVERED', deliveredAt: { gte: prevFrom } },
        select: { deliveredAt: true },
      }),
      this.prisma.order.groupBy({ by: ['status'], where: { createdAt: { gte: from } }, _count: { _all: true } }),
      this.prisma.user.groupBy({ by: ['role'], _count: { _all: true } }),
      this.prisma.orderItem.findMany({
        where: { order: { createdAt: { gte: from }, status: { notIn: NOT_SOLD as never } } },
        select: { name: true, quantity: true },
      }),
      this.live(),
    ]);

    // Empty buckets for every day so the chart has no gaps.
    const buckets = new Map<string, AnalyticsPoint>();
    for (let i = 0; i < days; i++) {
      const date = dayKey(new Date(from.getTime() + i * DAY_MS));
      buckets.set(date, { date, orders: 0, orderValue: 0, newUsers: 0, appointments: 0, deliveries: 0 });
    }
    const totals = emptyTotals();
    const previous = emptyTotals();
    const add = (at: Date, apply: (p: AnalyticsPoint | AnalyticsTotals) => void) => {
      if (at >= from) {
        const b = buckets.get(dayKey(at));
        if (b) apply(b);
        apply(totals);
      } else if (at >= prevFrom) {
        apply(previous);
      }
    };

    const pharmacyAgg = new Map<string, { orders: number; orderValue: number }>();
    for (const o of orders) {
      const sold = !NOT_SOLD.includes(o.status);
      const value = sold ? toMoney(o.total) : 0;
      add(o.createdAt, (p) => {
        p.orders += 1;
        p.orderValue += value;
      });
      if (o.createdAt >= from) {
        const agg = pharmacyAgg.get(o.pharmacyId) ?? { orders: 0, orderValue: 0 };
        agg.orders += 1;
        agg.orderValue += value;
        pharmacyAgg.set(o.pharmacyId, agg);
      }
    }
    for (const u of users) add(u.createdAt, (p) => void (p.newUsers += 1));
    for (const a of appointments) add(a.createdAt, (p) => void (p.appointments += 1));
    for (const d of deliveries) if (d.deliveredAt) add(d.deliveredAt, (p) => void (p.deliveries += 1));

    const topIds = [...pharmacyAgg.entries()].sort((a, b) => b[1].orders - a[1].orders).slice(0, 5);
    const names = await this.prisma.pharmacyProfile.findMany({
      where: { userId: { in: topIds.map(([id]) => id) } },
      select: { userId: true, name: true },
    });
    const nameOf = new Map(names.map((n) => [n.userId, n.name]));

    const medAgg = new Map<string, number>();
    for (const it of items) medAgg.set(it.name, (medAgg.get(it.name) ?? 0) + it.quantity);

    const round = (t: AnalyticsTotals) => ({ ...t, orderValue: Math.round(t.orderValue * 100) / 100 });
    return {
      days,
      from: from.toISOString(),
      to: to.toISOString(),
      series: [...buckets.values()].map((p) => ({ ...p, orderValue: Math.round(p.orderValue * 100) / 100 })),
      totals: round(totals),
      previous: round(previous),
      ordersByStatus: ordersByStatus
        .map((r) => ({ status: r.status, count: r._count._all }))
        .sort((a, b) => b.count - a.count),
      usersByRole: usersByRole.map((r) => ({ role: r.role, count: r._count._all })).sort((a, b) => b.count - a.count),
      topPharmacies: topIds.map(([id, agg]) => ({
        id,
        name: nameOf.get(id) ?? 'Unknown pharmacy',
        orders: agg.orders,
        orderValue: Math.round(agg.orderValue * 100) / 100,
      })),
      topMedicines: [...medAgg.entries()]
        .map(([name, quantity]) => ({ name, quantity }))
        .sort((a, b) => b.quantity - a.quantity)
        .slice(0, 5),
      live,
    };
  }

  private async live() {
    const [activeDeliveries, ridersOnline, pendingApprovals, newMessages] = await Promise.all([
      this.prisma.delivery.count({ where: { activeOrderId: { not: null } } }),
      this.prisma.riderProfile.count({ where: { isOnline: true } }),
      this.prisma.user.count({ where: { status: 'PENDING' } }),
      this.prisma.contactMessage.count({ where: { handled: false } }),
    ]);
    return { activeDeliveries, ridersOnline, pendingApprovals, newMessages };
  }
}

function emptyTotals(): AnalyticsTotals {
  return { orders: 0, orderValue: 0, newUsers: 0, appointments: 0, deliveries: 0 };
}
