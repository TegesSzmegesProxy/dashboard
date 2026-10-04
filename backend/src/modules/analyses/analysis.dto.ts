import { ApiProperty } from '@nestjs/swagger';
import { IsMongoId, IsNumber, Max, Min, ValidateIf } from 'class-validator';
import { TenantParamsDto } from '../projects/project.dto.js';

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
}
