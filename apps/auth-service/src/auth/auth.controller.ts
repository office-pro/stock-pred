import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  AccessExtensionRequestDto,
  AuthTokens,
  AuthUser,
  BrandSummary,
  UserRole,
} from '@stockpred/shared-types';
import { AuthService } from './auth.service';
import {
  CreateBrandDto,
  CreateUserDto,
  ExtensionRequestDto,
  LoginDto,
  RefreshDto,
  ReviewExtensionDto,
  UpdateBrandDto,
  UpdateUserDto,
} from './dto';
import { AuthenticatedRequest, JwtAuthGuard } from './jwt.guard';
import { Roles, RolesGuard } from './roles.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto): Promise<{ user: AuthUser; tokens: AuthTokens }> {
    return this.auth.login(dto.email, dto.password);
  }

  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() dto: RefreshDto): Promise<AuthTokens> {
    return this.auth.refresh(dto.refreshToken);
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Body() dto: RefreshDto): Promise<void> {
    await this.auth.logout(dto.refreshToken);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@Req() request: AuthenticatedRequest): Promise<AuthUser> {
    return this.auth.getUser(request.user.sub);
  }

  @Get('brands')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPERADMIN, UserRole.ADMIN)
  listBrands(@Req() request: AuthenticatedRequest): Promise<BrandSummary[]> {
    return this.auth.listBrands(request.user.sub);
  }

  @Post('brands')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPERADMIN)
  createBrand(
    @Req() request: AuthenticatedRequest,
    @Body() dto: CreateBrandDto,
  ): Promise<BrandSummary> {
    return this.auth.createBrand(request.user.sub, dto);
  }

  @Get('brands/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPERADMIN, UserRole.ADMIN)
  getBrand(@Req() request: AuthenticatedRequest, @Param('id') id: string): Promise<BrandSummary> {
    return this.auth.getBrand(request.user.sub, id);
  }

  @Patch('brands/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPERADMIN, UserRole.ADMIN)
  updateBrand(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: UpdateBrandDto,
  ): Promise<BrandSummary> {
    return this.auth.updateBrand(request.user.sub, id, dto);
  }

  @Get('users')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPERADMIN, UserRole.ADMIN)
  listUsers(
    @Req() request: AuthenticatedRequest,
    @Query('brandId') brandId?: string,
  ): Promise<AuthUser[]> {
    return this.auth.listUsers(request.user.sub, brandId);
  }

  @Post('users')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPERADMIN, UserRole.ADMIN)
  createUser(@Req() request: AuthenticatedRequest, @Body() dto: CreateUserDto): Promise<AuthUser> {
    return this.auth.createUser(request.user.sub, dto);
  }

  @Patch('users/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPERADMIN, UserRole.ADMIN)
  updateUser(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
  ): Promise<AuthUser> {
    return this.auth.updateUser(request.user.sub, id, dto);
  }

  @Delete('users/:id')
  @HttpCode(204)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPERADMIN, UserRole.ADMIN)
  async deleteUser(@Req() request: AuthenticatedRequest, @Param('id') id: string): Promise<void> {
    await this.auth.softDeleteUser(request.user.sub, id);
  }

  @Post('extensions')
  @UseGuards(JwtAuthGuard)
  requestExtension(
    @Req() request: AuthenticatedRequest,
    @Body() dto: ExtensionRequestDto,
  ): Promise<AccessExtensionRequestDto> {
    return this.auth.requestExtension(request.user.sub, dto);
  }

  @Get('extensions')
  @UseGuards(JwtAuthGuard)
  listExtensions(@Req() request: AuthenticatedRequest): Promise<AccessExtensionRequestDto[]> {
    return this.auth.listExtensions(request.user.sub);
  }

  @Post('extensions/:id/review')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPERADMIN, UserRole.ADMIN)
  reviewExtension(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: ReviewExtensionDto,
  ): Promise<AccessExtensionRequestDto> {
    return this.auth.reviewExtension(request.user.sub, id, dto);
  }
}
