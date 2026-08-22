import {
  IsArray,
  IsDateString,
  IsEmail,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { AppView, UserRole } from '@stockpred/shared-types';

export class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(1)
  password!: string;
}

export class RefreshDto {
  @IsString()
  @MinLength(20)
  refreshToken!: string;
}

export class CreateBrandDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(120)
  domain!: string;

  @IsNumber()
  @Min(0)
  paperCapital!: number;

  @IsOptional()
  @IsEmail()
  contactEmail?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  contactPhone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  logoUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  /** Optional first admin for the brand. */
  @IsOptional()
  @IsEmail()
  adminEmail?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  adminName?: string;

  @ValidateIf((o: CreateBrandDto) => Boolean(o.adminEmail))
  @IsString()
  @MinLength(10)
  @MaxLength(128)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, {
    message: 'Password must contain lower case, upper case and a digit',
  })
  adminPassword?: string;
}

export class UpdateBrandDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  domain?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  paperCapital?: number;

  @IsOptional()
  @IsEmail()
  contactEmail?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  contactPhone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  logoUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @IsOptional()
  @IsString()
  status?: string;
}

export class CreateUserDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;

  @IsString()
  @MinLength(10)
  @MaxLength(128)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, {
    message: 'Password must contain lower case, upper case and a digit',
  })
  password!: string;

  @IsEnum(UserRole)
  role!: UserRole;

  @IsOptional()
  @IsUUID()
  brandId?: string;

  @IsArray()
  @IsEnum(AppView, { each: true })
  allowedViews!: AppView[];

  /** ISO datetime or omit for non-viewers. */
  @IsOptional()
  @IsDateString()
  accessExpiresAt?: string;
}

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsArray()
  @IsEnum(AppView, { each: true })
  allowedViews?: AppView[];

  @IsOptional()
  @IsDateString()
  accessExpiresAt?: string | null;

  @IsOptional()
  @IsString()
  status?: string;
}

export class ExtensionRequestDto {
  /** Absolute expiry, or use duration fields below. */
  @IsOptional()
  @IsDateString()
  requestedUntil?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  days?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  hours?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  minutes?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class ReviewExtensionDto {
  @IsString()
  decision!: 'APPROVED' | 'DENIED';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
