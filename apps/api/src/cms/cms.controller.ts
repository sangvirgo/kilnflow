import { Body, Controller, Get, Put, Headers } from '@nestjs/common';
import { CmsService } from './cms.service';
import { AppError } from '../common/errors';

@Controller('cms')
export class CmsController {
  constructor(private cms: CmsService) {}

  /** Nội dung landing (merge mặc định + DB). Public — landing page đọc. */
  @Get('content')
  content() {
    return this.cms.get();
  }

  /** Lưu nội dung mới. Demo token: header x-cms-token phải khớp CMS_TOKEN env (mặc định kilnflow-cms). */
  @Put('content')
  async save(@Body() body: unknown, @Headers('x-cms-token') token?: string) {
    const expected = this.cms.token;
    if (!token || token !== expected) {
      throw new AppError(401, 'CMS_UNAUTHORIZED', 'Token CMS không đúng — kiểm tra ô Token trong trang CMS.');
    }
    return this.cms.save(body);
  }
}
