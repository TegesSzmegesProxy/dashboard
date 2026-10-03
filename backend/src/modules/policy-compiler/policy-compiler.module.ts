import { Module } from '@nestjs/common';
import { PolicyCompilerService } from './policy-compiler.service.js';

@Module({
  providers: [PolicyCompilerService],
  exports: [PolicyCompilerService],
})
export class PolicyCompilerModule {}
