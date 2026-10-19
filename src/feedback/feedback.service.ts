import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Feedback, Group, GroupMember, User } from '../database/entities/index.js';
import { detectReceiptType, RECEIPT_MAX_BYTES } from '../expenses/receipt-file.js';
import { EmailService, emailLayout, escapeHtml } from '../notifications/email.service.js';
import { StorageService } from '../storage/storage.service.js';
import type { CreateFeedbackDto, FeedbackQueryDto, UpdateFeedbackDto } from './dto/feedback.dto.js';

const DEFAULT_LIMIT = 50;

export interface UploadedImage {
  buffer: Buffer;
  size: number;
}

/**
 * In-app feedback for the closed beta (PDF Phase 13 "structured feedback capture"). Every report
 * is emailed to FEEDBACK_EMAIL (comma-separated) and triaged through the ops endpoints. Testers
 * see the status and the team's note on their own reports.
 */
@Injectable()
export class FeedbackService {
  private readonly logger = new Logger(FeedbackService.name);
  private readonly notify: string[];

  constructor(
    @InjectRepository(Feedback) private readonly feedback: Repository<Feedback>,
    @InjectRepository(GroupMember) private readonly members: Repository<GroupMember>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Group) private readonly groups: Repository<Group>,
    private readonly email: EmailService,
    private readonly storage: StorageService,
    config: ConfigService,
  ) {
    this.notify = (config.get<string>('FEEDBACK_EMAIL') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  async create(userId: string, dto: CreateFeedbackDto) {
    if (dto.groupId && !(await this.members.existsBy({ groupId: dto.groupId, userId }))) {
      throw new NotFoundException('Group not found');
    }
    const saved = await this.feedback.save(
      this.feedback.create({
        userId,
        groupId: dto.groupId ?? null,
        category: dto.category,
        message: dto.message.trim(),
        rating: dto.rating ?? null,
        screen: dto.screen?.trim() || null,
        appVersion: dto.appVersion?.trim() || null,
        platform: dto.platform ?? null,
        osVersion: dto.osVersion?.trim() || null,
        deviceModel: dto.deviceModel?.trim() || null,
      }),
    );
    this.emailTeam(saved).catch((err: Error) => this.logger.warn(`Feedback email failed: ${err.message}`));
    return this.toView(saved);
  }

  /** The tester's own reports, newest first, with status and the team's note. */
  async listMine(userId: string) {
    const rows = await this.feedback.find({ where: { userId }, order: { createdAt: 'DESC' }, take: 100 });
    return rows.map((f) => this.toView(f));
  }

  /** A screenshot for a report (image only, ≤ 5 MB). Only the person who sent it can attach one. */
  async attachScreenshot(userId: string, id: string, file: UploadedImage | undefined) {
    const row = await this.feedback.findOne({ where: { id, userId } });
    if (!row) throw new NotFoundException('Feedback not found');
    if (!file?.buffer?.length) throw new BadRequestException('Attach the screenshot as multipart field "file"');
    if (file.size > RECEIPT_MAX_BYTES) throw new PayloadTooLargeException('Screenshot must be 5 MB or smaller');
    const type = detectReceiptType(file.buffer);
    if (!type || type.contentType === 'application/pdf') {
      throw new UnsupportedMediaTypeException('Screenshot must be a JPEG, PNG, WebP or HEIC image');
    }
    const key = `feedback/${id}/${randomUUID()}.${type.extension}`;
    await this.storage.put(key, file.buffer, type.contentType);
    await this.feedback.update({ id }, { screenshotKey: key, screenshotContentType: type.contentType });
    if (row.screenshotKey) await this.storage.delete(row.screenshotKey);
    return this.toView({ ...row, screenshotKey: key, screenshotContentType: type.contentType });
  }

  // ---------------------------------------------------------------- ops (team) side

  async list(query: FeedbackQueryDto) {
    const limit = query.limit ?? DEFAULT_LIMIT;
    const qb = this.feedback
      .createQueryBuilder('f')
      .leftJoinAndSelect('f.user', 'u')
      .leftJoinAndSelect('f.group', 'g')
      .orderBy('f.created_at', 'DESC')
      .addOrderBy('f.id', 'DESC')
      .take(limit + 1);
    if (query.status) qb.andWhere('f.status = :status', { status: query.status });
    if (query.category) qb.andWhere('f.category = :category', { category: query.category });
    if (query.before) {
      const cursor = await this.feedback.findOne({ where: { id: query.before }, select: { id: true, createdAt: true } });
      if (!cursor) throw new BadRequestException('before must be a feedback id');
      qb.andWhere('(f.created_at, f.id) < (:at, :id)', { at: cursor.createdAt, id: cursor.id });
    }
    const rows = await qb.getMany();
    const page = rows.slice(0, limit);
    return {
      items: page.map((f) => this.toOpsView(f)),
      nextBefore: rows.length > limit ? page[page.length - 1].id : null,
    };
  }

  async get(id: string) {
    return this.toOpsView(await this.findForOps(id));
  }

  async update(id: string, dto: UpdateFeedbackDto) {
    await this.findForOps(id);
    await this.feedback.update({ id }, {
      ...(dto.status && { status: dto.status }),
      ...(dto.opsNote !== undefined && { opsNote: dto.opsNote.trim() || null }),
    });
    return this.get(id);
  }

  async screenshot(id: string) {
    const row = await this.findForOps(id);
    const data = row.screenshotKey ? await this.storage.get(row.screenshotKey) : null;
    if (!data || !row.screenshotContentType) throw new NotFoundException('This report has no screenshot');
    return { data, contentType: row.screenshotContentType };
  }

  private async findForOps(id: string): Promise<Feedback> {
    const row = await this.feedback.findOne({ where: { id }, relations: { user: true, group: true } });
    if (!row) throw new NotFoundException('Feedback not found');
    return row;
  }

  private async emailTeam(row: Feedback): Promise<void> {
    if (!this.notify.length) {
      this.logger.log(`[FEEDBACK] ${row.category} ${row.id} (set FEEDBACK_EMAIL to be emailed)`);
      return;
    }
    const [user, group] = await Promise.all([
      this.users.findOneByOrFail({ id: row.userId }),
      row.groupId ? this.groups.findOneBy({ id: row.groupId }) : Promise.resolve(null),
    ]);
    const device = [row.platform, row.osVersion, row.deviceModel].filter(Boolean).join(' · ') || 'unknown device';
    const lines: [string, string][] = [
      ['From', `${user.name} (@${user.username}) ${user.email ?? user.phone ?? ''}`.trim()],
      ['Trip', group ? group.name : '—'],
      ['Screen', row.screen ?? '—'],
      ['App', `${row.appVersion ?? 'unknown version'} on ${device}`],
      ['Rating', row.rating ? `${row.rating}/5` : '—'],
      ['Id', row.id],
    ];
    const subject = `[TravelGo beta] ${row.category}: ${row.message.slice(0, 60)}${row.message.length > 60 ? '…' : ''}`;
    const text = `${row.message}\n\n${lines.map(([k, v]) => `${k}: ${v}`).join('\n')}`;
    const html = emailLayout(
      `<p style="white-space:pre-wrap">${escapeHtml(row.message)}</p><table>` +
        lines.map(([k, v]) => `<tr><td style="color:#6b7280;padding-right:12px">${k}</td><td>${escapeHtml(v)}</td></tr>`).join('') +
        '</table>',
    );
    for (const to of this.notify) await this.email.send({ to, subject, text, html });
  }

  private toView(f: Feedback) {
    return {
      id: f.id,
      category: f.category,
      message: f.message,
      rating: f.rating,
      screen: f.screen,
      groupId: f.groupId,
      status: f.status,
      opsNote: f.opsNote,
      hasScreenshot: !!f.screenshotKey,
      createdAt: f.createdAt,
    };
  }

  private toOpsView(f: Feedback) {
    return {
      ...this.toView(f),
      user: { userId: f.user.id, username: f.user.username, name: f.user.name },
      group: f.group ? { id: f.group.id, name: f.group.name } : null,
      appVersion: f.appVersion,
      platform: f.platform,
      osVersion: f.osVersion,
      deviceModel: f.deviceModel,
      updatedAt: f.updatedAt,
    };
  }
}
