// CLI 진입점.
//
// 사용 예:
//   npm run publish -- --title "오늘의 회고" --body-file ./post.txt --tags "회고,일상" --visibility all
//   npm run publish -- --title "테스트" --body "본문입니다" --dry-run
//
// 옵션:
//   --title        (필수) 글 제목
//   --body         본문 텍스트 (직접 입력)
//   --body-file    본문 텍스트가 담긴 파일 경로 (--body 대신 사용)
//   --tags         콤마로 구분한 태그 목록 (옵션)
//   --category     정확한 카테고리 이름 (옵션)
//   --visibility   all | neighbor | me (옵션, 기본값: 건드리지 않음 = 에디터 기본값 유지)
//   --dry-run      끝까지 입력만 하고 최종 발행 버튼은 누르지 않음

import fs from 'node:fs';
import { publishPost } from '../src/naverBlogPoster.js';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    if (key === 'dry-run') {
      args.dryRun = true;
      continue;
    }
    args[key] = argv[i + 1];
    i++;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.title) {
    console.error('❌ --title 은 필수입니다.');
    process.exit(1);
  }

  let body = args.body;
  if (!body && args['body-file']) {
    body = fs.readFileSync(args['body-file'], 'utf-8');
  }
  if (!body) {
    console.error('❌ --body 또는 --body-file 중 하나는 필수입니다.');
    process.exit(1);
  }

  const tags = args.tags ? args.tags.split(',').map((t) => t.trim()).filter(Boolean) : [];

  await publishPost({
    title: args.title,
    body,
    tags,
    category: args.category,
    visibility: args.visibility,
    dryRun: Boolean(args.dryRun),
  });
}

main().catch((err) => {
  console.error('❌ 실행 중 오류:', err);
  process.exit(1);
});
