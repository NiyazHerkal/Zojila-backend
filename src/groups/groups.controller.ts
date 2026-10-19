import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import type { JwtPayload } from '../auth/strategies/jwt.strategy.js';
import { GroupRole, type GroupMember } from '../database/entities/index.js';
import { perMinute, RATE_LIMITS } from '../security/rate-limit.js';
import { IMAGE_MAX_BYTES } from '../storage/image-file.js';
import { CurrentMembership } from './decorators/current-membership.decorator.js';
import { AddMemberDto } from './dto/add-member.dto.js';
import { CreateGroupDto } from './dto/create-group.dto.js';
import { CreateInviteDto } from './dto/create-invite.dto.js';
import { UpdateGroupDto } from './dto/update-group.dto.js';
import { UpdateMemberRoleDto } from './dto/update-member-role.dto.js';
import { GroupsService, type UploadedCoverImage } from './groups.service.js';
import { AllowWhenClosed, GroupMemberGuard, GroupRoles } from './guards/group-member.guard.js';
import { InvitesService } from './invites.service.js';

const ADMIN = [GroupRole.ADMIN];

@ApiTags('groups')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('groups')
export class GroupsController {
  constructor(
    private readonly groupsService: GroupsService,
    private readonly invitesService: InvitesService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create a private group. The creator becomes its first admin.' })
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateGroupDto) {
    return this.groupsService.create(user.sub, dto);
  }

  @Get()
  @ApiOperation({ summary: "List the current user's groups, with their role in each." })
  listMine(@CurrentUser() user: JwtPayload) {
    return this.groupsService.listMine(user.sub);
  }

  @Get(':groupId')
  @UseGuards(GroupMemberGuard)
  @ApiOperation({ summary: 'Get group details (members only).' })
  findOne(@Param('groupId') groupId: string, @CurrentMembership() membership: GroupMember) {
    return this.groupsService.findOne(groupId, membership);
  }

  @Patch(':groupId')
  @UseGuards(GroupMemberGuard)
  @GroupRoles(ADMIN)
  @ApiOperation({ summary: 'Edit group name/description/trip dates (admin).' })
  update(
    @Param('groupId') groupId: string,
    @CurrentMembership() membership: GroupMember,
    @Body() dto: UpdateGroupDto,
  ) {
    return this.groupsService.update(groupId, membership, dto);
  }

  @Post(':groupId/close')
  @HttpCode(200)
  @UseGuards(GroupMemberGuard)
  @GroupRoles(ADMIN)
  @AllowWhenClosed()
  @ApiOperation({
    summary: 'Close the trip (admin): read-only, then deleted for good after 30 days unless reopened. Members get a push.',
  })
  close(@Param('groupId') groupId: string, @CurrentMembership() membership: GroupMember) {
    return this.groupsService.close(groupId, membership);
  }

  @Post(':groupId/reopen')
  @HttpCode(200)
  @UseGuards(GroupMemberGuard)
  @GroupRoles(ADMIN)
  @AllowWhenClosed()
  @ApiOperation({ summary: 'Reopen a closed trip before it is deleted (admin).' })
  reopen(@Param('groupId') groupId: string, @CurrentMembership() membership: GroupMember) {
    return this.groupsService.reopen(groupId, membership);
  }

  @Delete(':groupId')
  @UseGuards(GroupMemberGuard)
  @GroupRoles(ADMIN)
  @AllowWhenClosed()
  @ApiOperation({ summary: 'Delete the group and all its data now (admin).' })
  remove(@Param('groupId') groupId: string) {
    return this.groupsService.remove(groupId);
  }

  // --- cover image ---

  @Post(':groupId/cover-image')
  @HttpCode(200)
  @UseGuards(GroupMemberGuard)
  @GroupRoles(ADMIN)
  @Throttle(perMinute(RATE_LIMITS.upload))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } }, required: ['file'] } })
  @ApiOperation({ summary: 'Set or replace the trip cover image (admin): JPEG/PNG/WebP, max 5 MB, field `file`.' })
  // Allow a little over the limit here so the service can answer with a clear 413 message.
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: IMAGE_MAX_BYTES + 1, files: 1 } }))
  putCoverImage(
    @Param('groupId') groupId: string,
    @CurrentMembership() membership: GroupMember,
    @UploadedFile() file: UploadedCoverImage | undefined,
  ) {
    return this.groupsService.putCoverImage(groupId, membership, file);
  }

  @Get(':groupId/cover-image')
  @UseGuards(GroupMemberGuard)
  @ApiProduces('image/jpeg', 'image/png', 'image/webp')
  // Safe to cache for good: a new upload gets a new `?v=` URL.
  @Header('Cache-Control', 'private, max-age=31536000, immutable')
  @ApiOperation({ summary: 'Download the trip cover image (members). Use `coverImageUrl` from the group.' })
  async getCoverImage(@Param('groupId') groupId: string) {
    const { data, contentType } = await this.groupsService.getCoverImage(groupId);
    return new StreamableFile(data, { type: contentType, length: data.length });
  }

  @Delete(':groupId/cover-image')
  @UseGuards(GroupMemberGuard)
  @GroupRoles(ADMIN)
  @ApiOperation({ summary: 'Remove the trip cover image (admin).' })
  deleteCoverImage(@Param('groupId') groupId: string, @CurrentMembership() membership: GroupMember) {
    return this.groupsService.deleteCoverImage(groupId, membership);
  }

  // --- members ---

  @Get(':groupId/members')
  @UseGuards(GroupMemberGuard)
  @ApiOperation({ summary: 'List group members and their roles (members only).' })
  listMembers(@Param('groupId') groupId: string) {
    return this.groupsService.listMembers(groupId);
  }

  @Post(':groupId/members')
  @UseGuards(GroupMemberGuard)
  @GroupRoles(ADMIN)
  @ApiOperation({ summary: 'Add a registered user directly by email or phone (admin). No invite needed.' })
  addMember(
    @Param('groupId') groupId: string,
    @Body() dto: AddMemberDto,
    @CurrentMembership() membership: GroupMember,
  ) {
    return this.groupsService.addMember(groupId, membership.userId, dto);
  }

  @Patch(':groupId/members/:userId')
  @UseGuards(GroupMemberGuard)
  @GroupRoles(ADMIN)
  @ApiOperation({ summary: "Change a member's role, Admin ↔ Viewer (admin). The last admin can't be demoted." })
  updateMemberRole(
    @Param('groupId') groupId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: UpdateMemberRoleDto,
    @CurrentMembership() membership: GroupMember,
  ) {
    return this.groupsService.updateMemberRole(groupId, membership.userId, userId, dto.role);
  }

  @Delete(':groupId/members/:userId')
  @UseGuards(GroupMemberGuard)
  @AllowWhenClosed() // leaving a closed trip is fine
  @ApiOperation({
    summary: 'Remove a member (admin), or leave the group (your own userId). The last admin can’t leave.',
  })
  removeMember(
    @Param('groupId') groupId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @CurrentMembership() membership: GroupMember,
  ) {
    return this.groupsService.removeMember(groupId, membership, userId);
  }

  // --- invites (admin side) ---

  @Post(':groupId/invites')
  @UseGuards(GroupMemberGuard)
  @GroupRoles(ADMIN)
  @ApiOperation({
    summary:
      'Create an invite (admin): LINK returns a shareable token/link (shown once); EMAIL/SMS sends an invitation to one person.',
  })
  createInvite(
    @Param('groupId') groupId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateInviteDto,
  ) {
    return this.invitesService.create(groupId, user.sub, dto);
  }

  @Get(':groupId/invites')
  @UseGuards(GroupMemberGuard)
  @GroupRoles(ADMIN)
  @ApiOperation({ summary: 'List pending, unexpired invites for the group (admin).' })
  listInvites(@Param('groupId') groupId: string) {
    return this.invitesService.listForGroup(groupId);
  }

  @Delete(':groupId/invites/:inviteId')
  @UseGuards(GroupMemberGuard)
  @GroupRoles(ADMIN)
  @ApiOperation({ summary: 'Revoke a pending invite or share link (admin).' })
  revokeInvite(
    @Param('groupId') groupId: string,
    @Param('inviteId', ParseUUIDPipe) inviteId: string,
  ) {
    return this.invitesService.revoke(groupId, inviteId);
  }
}
