import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ProxyService } from './proxy.service';
import { JwtAuthGuard } from '../auth/jwt.guard';

/**
 * Pass-through to the auth-service. Bodies are validated downstream by the
 * auth-service's own DTO pipeline (single source of truth for auth rules).
 */
@Controller('api/auth')
export class AuthProxyController {
  constructor(private readonly proxy: ProxyService) {}

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
  @UseGuards(JwtAuthGuard)
  me(@Headers('authorization') authorization?: string): Promise<unknown> {
    return this.proxy.get('auth', '/auth/me', {
      headers: authorization ? { authorization } : undefined,
    });
  }

  @Get('brands')
  @UseGuards(JwtAuthGuard)
  listBrands(@Headers('authorization') authorization?: string): Promise<unknown> {
    return this.proxy.get('auth', '/auth/brands', {
      headers: authorization ? { authorization } : undefined,
    });
  }

  @Post('brands')
  @UseGuards(JwtAuthGuard)
  createBrand(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: unknown,
  ): Promise<unknown> {
    return this.proxy.post('auth', '/auth/brands', body, {
      headers: authorization ? { authorization } : undefined,
    });
  }

  @Get('brands/:id')
  @UseGuards(JwtAuthGuard)
  getBrand(
    @Headers('authorization') authorization: string | undefined,
    @Param('id') id: string,
  ): Promise<unknown> {
    return this.proxy.get('auth', `/auth/brands/${id}`, {
      headers: authorization ? { authorization } : undefined,
    });
  }

  @Patch('brands/:id')
  @UseGuards(JwtAuthGuard)
  updateBrand(
    @Headers('authorization') authorization: string | undefined,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    return this.proxy.patch('auth', `/auth/brands/${id}`, body, {
      headers: authorization ? { authorization } : undefined,
    });
  }

  @Get('users')
  @UseGuards(JwtAuthGuard)
  listUsers(
    @Headers('authorization') authorization: string | undefined,
    @Query('brandId') brandId?: string,
  ): Promise<unknown> {
    const qs = brandId ? `?brandId=${encodeURIComponent(brandId)}` : '';
    return this.proxy.get('auth', `/auth/users${qs}`, {
      headers: authorization ? { authorization } : undefined,
    });
  }

  @Post('users')
  @UseGuards(JwtAuthGuard)
  createUser(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: unknown,
  ): Promise<unknown> {
    return this.proxy.post('auth', '/auth/users', body, {
      headers: authorization ? { authorization } : undefined,
    });
  }

  @Patch('users/:id')
  @UseGuards(JwtAuthGuard)
  updateUser(
    @Headers('authorization') authorization: string | undefined,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    return this.proxy.patch('auth', `/auth/users/${id}`, body, {
      headers: authorization ? { authorization } : undefined,
    });
  }

  @Delete('users/:id')
  @HttpCode(204)
  @UseGuards(JwtAuthGuard)
  deleteUser(
    @Headers('authorization') authorization: string | undefined,
    @Param('id') id: string,
  ): Promise<unknown> {
    return this.proxy.delete('auth', `/auth/users/${id}`, {
      headers: authorization ? { authorization } : undefined,
    });
  }

  @Get('extensions')
  @UseGuards(JwtAuthGuard)
  listExtensions(@Headers('authorization') authorization?: string): Promise<unknown> {
    return this.proxy.get('auth', '/auth/extensions', {
      headers: authorization ? { authorization } : undefined,
    });
  }

  @Post('extensions')
  @UseGuards(JwtAuthGuard)
  requestExtension(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: unknown,
  ): Promise<unknown> {
    return this.proxy.post('auth', '/auth/extensions', body, {
      headers: authorization ? { authorization } : undefined,
    });
  }

  @Post('extensions/:id/review')
  @UseGuards(JwtAuthGuard)
  reviewExtension(
    @Headers('authorization') authorization: string | undefined,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    return this.proxy.post('auth', `/auth/extensions/${id}/review`, body, {
      headers: authorization ? { authorization } : undefined,
    });
  }
}
