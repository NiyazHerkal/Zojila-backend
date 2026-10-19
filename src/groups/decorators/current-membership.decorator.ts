import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { GroupMember } from '../../database/entities/index.js';
import type { GroupScopedRequest } from '../guards/group-member.guard.js';

/** The caller's GroupMember row, set by GroupMemberGuard. Only valid on guarded routes. */
export const CurrentMembership = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): GroupMember => {
    const request = ctx.switchToHttp().getRequest<GroupScopedRequest>();
    return request.groupMembership!;
  },
);
