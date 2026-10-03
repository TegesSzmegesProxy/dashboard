import { BadRequestException } from '@nestjs/common';
import { ObjectId } from 'mongodb';

export function objectId(value: string): ObjectId {
  if (!ObjectId.isValid(value)) {
    throw new BadRequestException('Invalid resource identifier');
  }
  return new ObjectId(value);
}

export function isDuplicateKey(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 11000
  );
}
