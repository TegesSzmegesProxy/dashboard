import { BadRequestException } from '@nestjs/common';

export function assertIdempotencyKey(
  value: string | undefined,
): asserts value is string {
  if (
    !value ||
    value.length < 16 ||
    value.length > 200 ||
    !/^[-\w.]+$/.test(value)
  ) {
    throw new BadRequestException(
      'Idempotency-Key must contain 16-200 safe characters',
    );
  }
}
