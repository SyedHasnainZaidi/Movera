import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import {
  CurrentUser,
  type AuthUser,
} from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { AppConfigService } from '../config/app-config.service';
import { AuthService, type IssuedSession } from './auth.service';
import {
  AuthResponseDto,
  AuthUserDto,
  ChangePasswordDto,
  ForgotPasswordDto,
  LoginDto,
  RegisterDto,
  RegistrationResultDto,
  ResendVerificationDto,
  ResetPasswordDto,
  VerifyEmailDto,
} from './dto/auth.dto';

const REFRESH_COOKIE = 'physio_refresh';

@ApiTags('Authentication')
@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: AppConfigService,
  ) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('register')
  @ApiOperation({
    summary: 'Register a new patient or therapist',
    description:
      'Only PATIENT and THERAPIST may be requested. Any other role value is rejected. ' +
      'Returns NO access token: the account is created unverified and cannot sign in ' +
      'until the emailed verification link has been followed.',
  })
  @ApiResponse({ status: 201, type: RegistrationResultDto })
  async register(@Body() dto: RegisterDto): Promise<RegistrationResultDto> {
    return this.auth.register(dto);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('verify-email')
  @ApiOperation({
    summary: 'Confirm an email address using the token from the emailed link',
  })
  async verifyEmail(@Body() dto: VerifyEmailDto) {
    return this.auth.verifyEmail(dto.token);
  }

  @Public()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('resend-verification')
  @ApiOperation({
    summary: 'Send a fresh verification link',
    description:
      'Always reports success, whether or not the address has an account, so ' +
      'the endpoint cannot be used to discover registered email addresses.',
  })
  async resendVerification(@Body() dto: ResendVerificationDto) {
    return this.auth.resendVerification(dto.email);
  }

  @Public()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('forgot-password')
  @ApiOperation({
    summary: 'Email a password reset link',
    description:
      'Always reports success, whether or not the address has an account.',
  })
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.auth.forgotPassword(dto.email);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('reset-password')
  @ApiOperation({
    summary: 'Set a new password using the token from the reset link',
    description:
      'The token is single-use. Every existing session for the account is revoked.',
  })
  async resetPassword(@Body() dto: ResetPasswordDto) {
    return this.auth.resetPassword(dto.token, dto.newPassword);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('login')
  @ApiOperation({ summary: 'Sign in' })
  @ApiResponse({ status: 200, type: AuthResponseDto })
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponseDto> {
    const issued = await this.auth.login(dto, req.headers['user-agent']);
    this.setRefreshCookie(res, issued);
    return issued.response;
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('refresh')
  @ApiOperation({
    summary: 'Exchange the refresh cookie for a new access token',
    description:
      'The refresh token is rotated on every call. Replaying an already-rotated ' +
      'token revokes the entire chain for that user.',
  })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponseDto> {
    const raw = this.readRefreshCookie(req);
    const issued = await this.auth.refresh(raw, req.headers['user-agent']);
    this.setRefreshCookie(res, issued);
    return issued.response;
  }

  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('logout')
  @ApiOperation({ summary: 'Revoke the current refresh token' })
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const raw = req.cookies?.[REFRESH_COOKIE] as string | undefined;
    await this.auth.logout(raw);
    res.clearCookie(REFRESH_COOKIE, { path: this.config.refreshCookiePath });
  }

  @ApiBearerAuth()
  @Get('me')
  @ApiOperation({ summary: 'The signed-in user and their role profile id' })
  @ApiResponse({ status: 200, type: AuthUserDto })
  async me(@CurrentUser() user: AuthUser): Promise<AuthUserDto> {
    return this.auth.me(user.userId);
  }

  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Patch('password')
  @ApiOperation({
    summary: 'Change password',
    description: 'Revokes every other session belonging to this user.',
  })
  async changePassword(
    @CurrentUser() user: AuthUser,
    @Body() dto: ChangePasswordDto,
  ): Promise<void> {
    await this.auth.changePassword(user.userId, dto);
  }

  /**
   * The refresh token never appears in a JSON body - only in an HttpOnly
   * cookie, so client-side JavaScript (and therefore any XSS payload) cannot
   * read it. Scoped to the auth path so it is not attached to every API call.
   */
  private setRefreshCookie(res: Response, issued: IssuedSession): void {
    res.cookie(REFRESH_COOKIE, issued.refreshToken, {
      httpOnly: true,
      secure: this.config.cookieSecure,
      sameSite: this.config.cookieSecure ? 'none' : 'lax',
      path: this.config.refreshCookiePath,
      expires: issued.refreshExpiresAt,
    });
  }

  private readRefreshCookie(req: Request): string {
    const raw = req.cookies?.[REFRESH_COOKIE] as string | undefined;
    return raw ?? '';
  }
}
