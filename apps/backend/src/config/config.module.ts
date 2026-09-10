import { Global, Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { AppConfigService } from './app-config.service';
import { validateEnv } from './env.validation';

@Global()
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      // Boot fails loudly here if any secret is missing or malformed.
      validate: validateEnv,
      envFilePath: ['.env'],
      cache: true,
    }),
  ],
  providers: [AppConfigService],
  exports: [AppConfigService],
})
export class AppConfigModule {}
