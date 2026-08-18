// 최초 1회, 사람이 직접 로그인(아이디/비번, 2단계 인증, 캡차 포함)하고
// 그 세션(쿠키)을 저장해두는 스크립트.
//
// 아이디/비번을 스크립트에 넣어 자동 로그인시키지 않는 이유:
// 네이버는 반복적인 자동 로그인 시도를 봇으로 간주해 캡차/보안 인증을
// 요구하는 경우가 많습니다. 사람이 직접 로그인한 뒤 세션만 재사용하는 쪽이
// 훨씬 안정적입니다.
//
// 실행: npm run login

import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { config, urls } from './config.js';

async function main() {
  const browser = await chromium.launch({
    headless: false, // 로그인은 항상 화면을 띄워서 진행합니다.
    executablePath: config.chromiumExecutablePath,
  });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(urls.login, { waitUntil: 'domcontentloaded' });

  const rl = readline.createInterface({ input, output });
  await rl.question(
    '\n브라우저 창에서 네이버 로그인을 완료한 뒤(캡차/2단계 인증 포함), 이 터미널로 돌아와 Enter 를 누르세요...\n'
  );
  rl.close();

  // 로그인 성공 여부를 대충이라도 확인 (실패해도 치명적이지 않으므로 경고만 출력)
  const cookies = await context.cookies('https://www.naver.com');
  const hasSessionCookie = cookies.some((c) => c.name === 'NID_SES' || c.name === 'NID_AUT');
  if (!hasSessionCookie) {
    console.warn(
      '⚠️  로그인 세션 쿠키(NID_AUT/NID_SES)를 찾지 못했습니다. 로그인이 안 됐을 수 있어요. 그래도 저장은 진행합니다.'
    );
  }

  fs.mkdirSync(path.dirname(config.storageStatePath), { recursive: true });
  await context.storageState({ path: config.storageStatePath });
  console.log(`✅ 로그인 세션 저장 완료: ${config.storageStatePath}`);

  await browser.close();
}

main().catch((err) => {
  console.error('로그인 저장 중 오류:', err);
  process.exit(1);
});
