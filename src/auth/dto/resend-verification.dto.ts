import { ForgotPasswordDto } from './forgot-password.dto.js';

/** Same shape as forgot-password: the email or phone the account signed up with. */
export class ResendVerificationDto extends ForgotPasswordDto {}
