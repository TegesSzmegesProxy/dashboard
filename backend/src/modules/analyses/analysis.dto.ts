import { ApiProperty } from '@nestjs/swagger';
import {
  IsIn,
  IsMongoId,
  IsNumber,
  IsOptional,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { TenantParamsDto } from '../projects/project.dto.js';
import type { PolicyReviewMode } from './analysis.types.js';

export const POLICY_REVIEW_MODES = ['review', 'auto_apply'] as const;

export class AnalysisParamsDto extends TenantParamsDto {
  @IsMongoId()
  analysisId!: string;
}

export class ApproveBudgetDto {
  @ApiProperty({
    description:
      'Spending ceiling in USD; the analysis stops when it is reached.',
    example: 25,
  })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(10_000)
  ceilingUsd!: number;

  @ApiProperty({
    enum: POLICY_REVIEW_MODES,
    required: false,
    description:
      'What happens to the generated policy: `review` keeps it pending; `auto_apply` approves it when it compiles and has no review warning (ADR-0018). Defaults to `review`.',
  })
  @IsOptional()
  @IsIn(POLICY_REVIEW_MODES)
  policyReviewMode?: PolicyReviewMode;
}

export class AnalysisSettingsDto {
  @ApiProperty({
    nullable: true,
    description:
      'Analyses whose estimate fits under this ceiling start without manual approval. Null requires approval for every analysis.',
  })
  @ValidateIf((dto: AnalysisSettingsDto) => dto.autoApproveCeilingUsd !== null)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(10_000)
  autoApproveCeilingUsd!: number | null;

  @ApiProperty({
    enum: POLICY_REVIEW_MODES,
    required: false,
    description:
      'Review mode of analyses whose budget is approved automatically. Unchanged when omitted.',
  })
  @IsOptional()
  @IsIn(POLICY_REVIEW_MODES)
  defaultPolicyReviewMode?: PolicyReviewMode;
}
