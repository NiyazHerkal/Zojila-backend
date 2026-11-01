import {
  CanActivate,
  ConflictException,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { isUUID } from 'class-validator';
import type { GroupMember, GroupRole } from '../../database/entities/index.js';
import type { JwtPayload } from '../../auth/strategies/jwt.strategy.js';
import { ErrorCode, withCode } from '../../errors/error-codes.js';
import { GroupAccessService } from '../group-access.service.js';

/** Restricts a group-scoped route to the listed roles. Without it, any member passes. */
export const GroupRoles = Reflector.createDecorator<GroupRole[]>();

/** Lets a write route run on a closed trip (reopen, delete, leave). Reads always work. */
export const AllowWhenClosed = Reflector.createDecorator<boolean>({ transform: () => true });

/** The 409 for any write on a closed trip, with its own code so apps needn't match the message. */
export function tripClosedError(): ConflictException {
  return withCode(
    new ConflictException("This trip is closed, so it's read-only. An admin can reopen it."),
    ErrorCode.TRIP_CLOSED,
  );
}

export interface GroupScopedRequest {
  method: string;
  user: JwtPayload;
  params: Record<string, string | undefined>;
  groupMembership?: GroupMember;
}

/**
 * Members-only access for any route with a `:groupId` param. Use after JwtAuthGuard:
 * `@UseGuards(JwtAuthGuard, GroupMemberGuard)`.
 *
 * Non-members get 404 rather than 403 so group ids can't be probed (groups are private,
 * PDF §2.2). Members lacking a role required by `@GroupRoles()` get 403. On a closed trip,
 * writes get 409 unless the route has `@AllowWhenClosed()`. On success the
 * caller's membership is available via `@CurrentMembership()`.
 */
@Injectable()
export class GroupMemberGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly access: GroupAccessService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const request = ctx.switchToHttp().getRequest<GroupScopedRequest>();
    const groupId = request.params.groupId;
    if (!groupId || !isUUID(groupId)) throw new NotFoundException('Group not found');

    const membership = await this.access.findMembership(groupId, request.user.sub);
    if (!membership) throw new NotFoundException('Group not found');

    const roles = this.reflector.getAllAndOverride(GroupRoles, [ctx.getHandler(), ctx.getClass()]);
    if (roles?.length && !roles.includes(membership.role)) {
      throw new ForbiddenException(`Requires group role: ${roles.join(' or ')}`);
    }

    const allowWhenClosed = this.reflector.getAllAndOverride(AllowWhenClosed, [ctx.getHandler(), ctx.getClass()]);
    if (membership.group.closedAt && request.method !== 'GET' && !allowWhenClosed) {
      throw tripClosedError();
    }

    request.groupMembership = membership;
    return true;
  }
}
