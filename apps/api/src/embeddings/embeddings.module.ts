import { Global, Module } from '@nestjs/common';
import { EmbeddingService } from './embeddings.service';

@Global()
@Module({ providers: [EmbeddingService], exports: [EmbeddingService] })
export class EmbeddingsModule {}