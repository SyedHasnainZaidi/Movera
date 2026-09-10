import { Module } from '@nestjs/common';
import { TherapistsController } from './therapists.controller';
import { TherapistsService } from './therapists.service';

@Module({
  controllers: [TherapistsController],
  providers: [TherapistsService],
  exports: [TherapistsService],
})
export class TherapistsModule {}
