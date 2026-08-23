/**
 * Phase 8.6.1 — CLI thêm thợ được cấp phép DM bot.
 * Dùng: npm run worker:add -- --id=<telegramUserId> --name="Anh Ba"
 * (Lấy telegramUserId: nhắn bot 1 lần, xem log "[BẢO MẬT] ... chat lạ: <số>" hoặc hỏi @userinfobot)
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith('--' + name + '='));
  return hit ? hit.slice(name.length + 3) : undefined;
}

async function main() {
  const id = arg('id');
  const name = arg('name');
  if (!id || !name) {
    console.log('Dùng: npm run worker:add -- --id=<telegramUserId> --name="Anh Ba"');
    process.exit(1);
  }
  const worker = await prisma.authorizedWorker.upsert({
    where: { telegramUserId: id },
    create: { telegramUserId: id, displayName: name },
    update: { displayName: name },
  });
  console.log('[worker:add] OK →', worker.displayName, '(telegramUserId=' + worker.telegramUserId + ', công đoạn: ' + (worker.assignedStage ?? 'chưa gán') + ')');
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
