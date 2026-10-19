import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import {
  ArturoEvaluateResponse,
  ArturoFlagAuditRecord,
  ArturoFlagListResponse,
  ArturoFlagRecord,
  ArturoStatusResponse,
  UserRole,
} from '@stockpred/shared-types';
import { CreateArturoFlagDto, EvaluateArturoFlagsDto, UpdateArturoFlagDto } from './arturo.dto';
import { ArturoService } from './arturo.service';
import { AuthenticatedRequest, JwtAuthGuard } from './jwt.guard';
import { Roles, RolesGuard } from './roles.guard';

@Controller('auth/arturo')
export class ArturoController {
  constructor(private readonly arturo: ArturoService) {}

  @Get('status')
  @UseGuards(JwtAuthGuard)
  status(): ArturoStatusResponse {
    return this.arturo.status();
  }

  @Get('flags')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPERADMIN, UserRole.ADMIN)
  list(
    @Query('q') q?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ): Promise<ArturoFlagListResponse> {
    return this.arturo.list(q, page ? Number(page) : 1, pageSize ? Number(pageSize) : 50);
  }

  @Get('flags/:key')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPERADMIN, UserRole.ADMIN)
  get(@Param('key') key: string): Promise<ArturoFlagRecord> {
    return this.arturo.getByKey(key);
  }

  @Post('flags')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPERADMIN, UserRole.ADMIN)
  create(
    @Req() request: AuthenticatedRequest,
    @Body() dto: CreateArturoFlagDto,
  ): Promise<ArturoFlagRecord> {
    return this.arturo.create(request.user.sub, dto);
  }

  @Patch('flags/:key')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPERADMIN, UserRole.ADMIN)
  update(
    @Req() request: AuthenticatedRequest,
    @Param('key') key: string,
    @Body() dto: UpdateArturoFlagDto,
  ): Promise<ArturoFlagRecord> {
    return this.arturo.update(request.user.sub, key, dto);
  }

  @Get('flags/:key/history')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPERADMIN, UserRole.ADMIN)
  history(@Param('key') key: string): Promise<ArturoFlagAuditRecord[]> {
    return this.arturo.history(key);
  }

  @Post('evaluate')
  @UseGuards(JwtAuthGuard)
  evaluate(
    @Req() request: AuthenticatedRequest,
    @Body() dto: EvaluateArturoFlagsDto,
  ): Promise<ArturoEvaluateResponse> {
    return this.arturo.evaluate(request.user.sub, dto.keys);
  }
}
