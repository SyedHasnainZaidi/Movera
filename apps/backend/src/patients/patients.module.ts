import { Module } from '@nestjs/common';
import { TherapistsModule } from '../therapists/therapists.module';
import { PatientsController } from './patients.controller';
import { PatientsService } from './patients.service';

@Module({
  imports: [TherapistsModule],
  controllers: [PatientsController],
  providers: [PatientsService],
  exports: [PatientsService],
})
export class PatientsModule {}
