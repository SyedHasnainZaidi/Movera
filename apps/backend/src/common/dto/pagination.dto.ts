import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/** Standard paging query. Every growing list endpoint accepts this shape. */
export class PaginationQueryDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;

  get skip(): number {
    return (this.page - 1) * this.limit;
  }
}

export class PageMetaDto {
  @ApiProperty() page!: number;
  @ApiProperty() limit!: number;
  @ApiProperty() total!: number;
  @ApiProperty() totalPages!: number;
  @ApiProperty() hasNext!: boolean;
}

/**
 * Every paginated endpoint returns exactly this envelope - never a bare array.
 * Mixing the two shapes across similar endpoints was a defect in the
 * superseded Express prototype.
 */
export class PageDto<T> {
  data!: T[];
  meta!: PageMetaDto;

  static of<T>(data: T[], total: number, page: number, limit: number): PageDto<T> {
    const totalPages = limit > 0 ? Math.ceil(total / limit) : 0;
    return {
      data,
      meta: { page, limit, total, totalPages, hasNext: page < totalPages },
    };
  }
}
