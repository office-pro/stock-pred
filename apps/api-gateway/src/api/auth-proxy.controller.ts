import { Body, Controller, Get, Headers, HttpCode, Post } from '@nestjs/common';
import { ProxyService } from './proxy.service';

/**
 * Pass-through to the auth-service. Bodies are validated downstream by the
 * auth-service's own DTO pipeline (single source of truth for auth rules).
 */
@Controller('api/auth')
export class AuthProxyController {
  constructor(private readonly proxy: ProxyService) {}

  @Post('register')
  register(@Body() body: unknown): Promise<unknown> {
    return this.proxy.post('auth', '/auth/register', body);
  }

  @Post('login')
  @HttpCode(200)
  login(@Body() body: unknown): Promise<unknown> {
    return this.proxy.post('auth', '/auth/login', body);
  }

  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() body: unknown): Promise<unknown> {
    return this.proxy.post('auth', '/auth/refresh', body);
  }

  @Post('logout')
  @HttpCode(204)
  logout(@Body() body: unknown): Promise<unknown> {
    return this.proxy.post('auth', '/auth/logout', body);
  }

  @Get('me')
  me(@Headers('authorization') authorization?: string): Promise<unknown> {
    return this.proxy.get('auth', '/auth/me', {
      headers: authorization ? { authorization } : undefined,
    });
  }
}
