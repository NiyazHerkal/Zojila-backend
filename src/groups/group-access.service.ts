import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GroupMember } from '../database/entities/index.js';

/**
 * Membership lookup behind GroupMemberGuard. Exported so later modules can reuse the guard.
 * Loads the group too, so callers can check whether the trip is closed.
 */
@Injectable()
export class GroupAccessService {
  constructor(@InjectRepository(GroupMember) private readonly members: Repository<GroupMember>) {}

  findMembership(groupId: string, userId: string): Promise<GroupMember | null> {
    return this.members.findOne({ where: { groupId, userId }, relations: { group: true } });
  }
}
