import { Type } from 'class-transformer';
import { IsInt, IsMongoId, IsOptional, Max, Min } from 'class-validator';
import { ObjectId } from 'mongodb';

export class CursorPaginationDto {
  @IsOptional()
  @IsMongoId()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 50;
}

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

export function afterCursor(
  cursor: string | undefined,
): { $gt: ObjectId } | undefined {
  return cursor ? { $gt: new ObjectId(cursor) } : undefined;
}
