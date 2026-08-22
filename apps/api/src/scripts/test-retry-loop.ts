import { LlmTransport } from '../llm/llm.core';
import { MockLlmProvider } from '../llm/providers/mock.provider';
import { ParserAgent } from '../agents/parser.agent';
import { AgentValidationError } from '../common/errors';

const transport = new LlmTransport(new MockLlmProvider(), { timeoutMs: 5000, maxRetries: 0 });
const mockLlm: any = { complete: (msgs: any[], opts?: any) => transport.complete(msgs, opts) };
const parser = new ParserAgent(mockLlm);

const scenarios = [
  { name: 'A) Input tot', input: 'Dat 200 lo hoa hoa van sen men xanh ngoc cao 35cm nung o 1280 do C can gap trong 10 ngay', expectPass: true },
  { name: 'B) Thieu thong tin', input: 'Lam cho toi mot vai binh gom', expectPass: true },
  { name: 'C) MALFORMED_ONCE', input: '[MALFORMED_ONCE] Dat 300 bo am tra men trang nga deadline 15 ngay', expectPass: true },
  { name: 'D) ALWAYS_MALFORMED', input: '[ALWAYS_MALFORMED] 150 lo hoa men xanh ngoc', expectPass: false },
];

async function run() {
  let passed = 0, failed = 0;
  for (const s of scenarios) {
    process.stdout.write('TEST ' + s.name + ' ... ');

    try {
      const result = await parser.parse(s.input, (icon: string, msg: string) => process.stdout.write('  ' + icon + ' ' + msg + '\n'));
      if (s.expectPass) {
        console.log('PASS (' + result.product_name + ' x' + result.quantity + ' priority=' + result.priority + ')');
        passed++;
      } else {
        console.log('FAIL (expected error but got success)'); failed++;
      }
    } catch (err) {
      if (!s.expectPass && err instanceof AgentValidationError) {
        console.log('PASS (AgentValidationError caught)'); passed++;
      } else {
        console.log('FAIL (' + (err as Error).message + ')'); failed++;
      }
    }
  }
  console.log('\nResult: ' + passed + '/' + scenarios.length + ' passed' + (failed ? ' (' + failed + ' FAILED)' : ' — ALL PASS'));
  process.exit(failed ? 1 : 0);
}

run();