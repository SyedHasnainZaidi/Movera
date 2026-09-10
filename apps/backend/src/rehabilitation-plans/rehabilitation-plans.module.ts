import { Module } from '@nestjs/common';
import { RehabilitationPlansController } from './rehabilitation-plans.controller';
import { RehabilitationPlansService } from './rehabilitation-plans.service';

@Module({
  controllers: [RehabilitationPlansController],
  providers: [RehabilitationPlansService],
  exports: [RehabilitationPlansService],
})
export class RehabilitationPlansModule {}
