import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';

interface HealthResponse {
  status: 'ok';
  service: 'tessera-control-plane';
}

@ApiTags('health')
@Controller('health')
export class HealthController {
  @Get()
  @ApiOkResponse({
    schema: {
      example: { status: 'ok', service: 'tessera-control-plane' },
    },
  })
  getHealth(): HealthResponse {
    return { status: 'ok', service: 'tessera-control-plane' };
  }
}
