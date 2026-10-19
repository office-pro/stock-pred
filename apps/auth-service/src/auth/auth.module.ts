import { Module } from '@nestjs/common';
import { ArturoController } from './arturo.controller';
import { ArturoService } from './arturo.service';
import { AuditService } from './audit.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { RolesGuard } from './roles.guard';
import { TokenService } from './token.service';

@Module({
  controllers: [AuthController, ArturoController],
  providers: [AuthService, ArturoService, TokenService, AuditService, RolesGuard],
})
export class AuthModule {}
