import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../database/entities/index.js';
import { detectImageType, IMAGE_MAX_BYTES } from '../storage/image-file.js';
import { publicApiUrl } from '../storage/public-url.js';
import { StorageService } from '../storage/storage.service.js';

export interface UploadedAvatar {
  buffer: Buffer;
  size: number;
}

/**
 * Profile pictures (frontend request 2026-10-14: show photos instead of initials). Stored like
 * trip cover images at `avatars/<userId>/<uuid>.<ext>`. `avatarUrl` is set to our download URL,
 * so every payload that already carries `avatarUrl` (members, chat, expenses, live map…) shows it.
 */
@Injectable()
export class AvatarService {
  private readonly publicApiUrl: string;

  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly storage: StorageService,
    config: ConfigService,
  ) {
    this.publicApiUrl = publicApiUrl(config);
  }

  /** Sets or replaces the picture (JPEG/PNG/WebP, max 5 MB). Updates `user` in place. */
  async put(user: User, file: UploadedAvatar | undefined): Promise<User> {
    if (!file?.buffer?.length) throw new BadRequestException('Attach the image as multipart field "file"');
    if (file.size > IMAGE_MAX_BYTES) throw new PayloadTooLargeException('Profile picture must be 5 MB or smaller');
    const type = detectImageType(file.buffer);
    if (!type) throw new UnsupportedMediaTypeException('Profile picture must be a JPEG, PNG or WebP');

    const version = randomUUID();
    const key = `avatars/${user.id}/${version}.${type.extension}`;
    await this.storage.put(key, file.buffer, type.contentType);
    const oldKey = user.avatarKey;
    // The uuid makes the URL unguessable and doubles as a cache-busting version.
    const avatarUrl = `${this.publicApiUrl}/users/${user.id}/avatar?v=${version}`;
    await this.users.update({ id: user.id }, { avatarKey: key, avatarContentType: type.contentType, avatarUrl });
    Object.assign(user, { avatarKey: key, avatarContentType: type.contentType, avatarUrl });
    // The row points at the new file before the old one goes, so it's never left dangling.
    if (oldKey) await this.storage.delete(oldKey);
    return user;
  }

  /** Removes the picture, uploaded or external. Returns false if there wasn't one. */
  async remove(user: User): Promise<boolean> {
    if (!user.avatarUrl && !user.avatarKey) return false;
    await this.users.update({ id: user.id }, { avatarKey: null, avatarContentType: null, avatarUrl: null });
    if (user.avatarKey) await this.storage.delete(user.avatarKey);
    Object.assign(user, { avatarKey: null, avatarContentType: null, avatarUrl: null });
    return true;
  }

  async get(userId: string): Promise<{ data: Buffer; contentType: string }> {
    const user = await this.users.findOne({
      where: { id: userId },
      select: { id: true, avatarKey: true, avatarContentType: true, deletedAt: true },
    });
    if (!user || user.deletedAt || !user.avatarKey || !user.avatarContentType) {
      throw new NotFoundException('This user has no profile picture');
    }
    const data = await this.storage.get(user.avatarKey);
    if (!data) throw new NotFoundException('Profile picture file is missing');
    return { data, contentType: user.avatarContentType };
  }

  /**
   * For PATCH /auth/me replacing `avatarUrl`: the uploaded file it pointed at is no longer used.
   * Clears the key on the entity (the caller saves the rest).
   */
  async dropUploadedFile(user: User): Promise<void> {
    if (!user.avatarKey) return;
    const key = user.avatarKey;
    await this.users.update({ id: user.id }, { avatarKey: null, avatarContentType: null });
    Object.assign(user, { avatarKey: null, avatarContentType: null });
    await this.storage.delete(key);
  }
}
