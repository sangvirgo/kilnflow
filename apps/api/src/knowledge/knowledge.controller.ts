import { Body, Controller, Post } from '@nestjs/common';
import { KnowledgeService } from './knowledge.service';
import { AppError } from '../common/errors';

@Controller('knowledge')
export class KnowledgeController {
  constructor(private service: KnowledgeService) {}

  @Post('ask')
  ask(@Body() body: { question?: string }) {
    const q = (body?.question || '').trim();
    if (!q) throw new AppError(400, 'EMPTY_QUESTION', 'question is required.');
    return this.service.ask(q);
  }
}