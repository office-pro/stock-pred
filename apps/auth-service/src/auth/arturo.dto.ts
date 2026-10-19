import { ArturoReleaseMode } from '@stockpred/shared-types';
import {
  ArrayNotEmpty,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateArturoFlagDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  @Matches(/^feat_[a-z][a-z0-9_]*$/, {
    message: 'key must follow feat_<area>_<feature> (e.g. feat_desk_experimental_chip)',
  })
  key!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsEnum(ArturoReleaseMode)
  releaseMode?: ArturoReleaseMode;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  accountRulesRaw?: string;
}

export class UpdateArturoFlagDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @IsOptional()
  @IsEnum(ArturoReleaseMode)
  releaseMode?: ArturoReleaseMode;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  accountRulesRaw?: string;

  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

export class EvaluateArturoFlagsDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  keys!: string[];
}
