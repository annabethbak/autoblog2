// 네이버 블로그 글쓰기 화면(SmartEditor ONE) 자동화 로직.
//
// ⚠️ 셀렉터 관련 안내
// 이 코드는 캡처해주신 글쓰기 화면(제목/본문 placeholder, 상단 저장/발행 버튼,
// 사진·MYBOX·동영상 등 툴바)과 SmartEditor ONE의 알려진 DOM 구조를 바탕으로
// 작성했습니다. 다만 이 세션(컨테이너)의 네트워크 정책이 naver.com 접속을
// 막고 있어(조직 egress 정책상 403) 실제 DOM에 붙여 라이브로 검증하지는
// 못했습니다. 그래서:
//   - 가능한 한 CSS 해시 클래스(se-xxxxx 같은 빌드마다 바뀌는 값)보다
//     role/placeholder/text 기반의 안정적인 로케이터를 우선 사용했습니다.
//   - 실제로 안 맞는 부분이 있으면 로컬에서
//       npx playwright codegen https://blog.naver.com/<BLOG_ID>?Redirect=Write&
//     로 진짜 셀렉터를 뽑아 아래 SELECTORS 값만 교체하면 됩니다.
//   - 단계별로 실패하면 debug/ 폴더에 스크린샷을 남기도록 해뒀습니다.

import fs from 'node:fs';
import { chromium } from 'playwright';
import { config, urls } from './config.js';

const SELECTORS = {
  editorFrame: 'iframe#mainFrame',
  // 제목 입력 영역 (문서 제목 컴포넌트)
  title: '.se-documentTitle .se-text-paragraph',
  // 본문 첫 문단 (문서 제목 컴포넌트는 제외하고 본문 영역만)
  bodyFirstParagraph: '.se-main-container .se-component.se-text .se-text-paragraph',
  publishButton: { role: 'button', name: '발행' },
  tagInput: /태그/, // getByPlaceholder 용 정규식
};

async function screenshotOnError(page, label) {
  try {
    fs.mkdirSync('./debug', { recursive: true });
    const file = `./debug/${Date.now()}-${label}.png`;
    await page.screenshot({ path: file, fullPage: true });
    console.error(`   → 실패 지점 스크린샷 저장: ${file}`);
  } catch {
    // 스크린샷 저장 실패는 무시 (원래 에러를 가리지 않기 위함)
  }
}

/** 브라우저를 띄우고 저장해둔 로그인 세션으로 컨텍스트를 만든다. */
export async function launch() {
  if (!fs.existsSync(config.storageStatePath)) {
    throw new Error(
      `로그인 세션 파일이 없습니다: ${config.storageStatePath}\n` +
        '먼저 `npm run login` 을 실행해 네이버 로그인을 완료해주세요.'
    );
  }

  const browser = await chromium.launch({
    headless: config.headless,
    executablePath: config.chromiumExecutablePath,
  });
  const context = await browser.newContext({ storageState: config.storageStatePath });
  const page = await context.newPage();
  return { browser, context, page };
}

/** 글쓰기 페이지로 이동하고, "이어서 작성하시겠습니까" 같은 이전 임시저장 팝업을 처리한다. */
async function openWritePage(page) {
  await page.goto(urls.write(config.blogId), { waitUntil: 'domcontentloaded' });

  const editorFrame = page.frameLocator(SELECTORS.editorFrame);

  // 임시저장된 글이 있으면 "취소"를 눌러 새 글로 시작한다.
  // (계속 이어쓰고 싶다면 이 블록을 지우거나 버튼 이름을 '이어쓰기'로 바꾸세요.)
  try {
    const cancelBtn = editorFrame.getByRole('button', { name: '취소' });
    await cancelBtn.waitFor({ state: 'visible', timeout: 4000 });
    await cancelBtn.click();
  } catch {
    // 팝업이 없으면 정상 (새 글쓰기 첫 진입)
  }

  // 에디터가 실제로 로드됐는지 확인 (제목 영역이 뜰 때까지 대기)
  await editorFrame.locator(SELECTORS.title).first().waitFor({ state: 'visible', timeout: 15000 });

  return editorFrame;
}

/** 제목 입력 */
async function fillTitle(page, editorFrame, title) {
  const titleEl = editorFrame.locator(SELECTORS.title).first();
  await titleEl.click();
  await page.keyboard.type(title, { delay: 20 });
}

/** 본문 입력. 여러 줄이면 줄바꿈마다 새 문단(Enter)으로 나눠 입력한다. */
async function fillBody(page, editorFrame, bodyText) {
  // 제목 다음 Enter/Tab 을 누르면 보통 본문 첫 문단으로 포커스가 넘어가지만,
  // 안정성을 위해 본문 영역을 직접 한 번 더 클릭해 포커스를 명확히 한다.
  const bodyEl = editorFrame.locator(SELECTORS.bodyFirstParagraph).first();
  await bodyEl.click();

  const lines = bodyText.split('\n');
  for (let i = 0; i < lines.length; i++) {
    await page.keyboard.type(lines[i], { delay: 10 });
    if (i < lines.length - 1) {
      await page.keyboard.press('Enter');
    }
  }
}

/** 태그 입력 (옵션) */
async function fillTags(editorFrame, tags = []) {
  if (!tags.length) return;
  try {
    const tagInput = editorFrame.getByPlaceholder(SELECTORS.tagInput);
    await tagInput.waitFor({ state: 'visible', timeout: 5000 });
    for (const tag of tags) {
      await tagInput.fill(tag);
      await tagInput.press('Enter');
    }
  } catch (err) {
    console.warn('⚠️  태그 입력란을 찾지 못해 태그는 건너뜁니다:', err.message);
  }
}

/** 공개 설정 (옵션). visibility: 'all' | 'neighbor' | 'me' */
async function setVisibility(editorFrame, visibility) {
  if (!visibility) return;
  const label = { all: '전체공개', neighbor: '이웃공개', me: '비공개' }[visibility];
  if (!label) {
    console.warn(`⚠️  알 수 없는 visibility 값(${visibility}) - 건너뜁니다.`);
    return;
  }
  try {
    await editorFrame.getByText(label, { exact: true }).first().click({ timeout: 5000 });
  } catch (err) {
    console.warn(`⚠️  공개설정(${label}) 라디오를 찾지 못해 건너뜁니다:`, err.message);
  }
}

/**
 * 상단 "발행" 버튼 → 발행 설정 패널 → 패널 안의 최종 "발행" 버튼까지 클릭한다.
 * 패널이 열리면 화면에 "발행" 텍스트를 가진 버튼이 2개(툴바용 + 패널 확정용)
 * 존재할 수 있어, 패널이 열린 뒤 나타나는 마지막 버튼을 최종 발행으로 간주한다.
 * 실제 DOM에서 다르면 이 함수의 로케이터만 교체하면 된다.
 */
async function publishFlow(page, editorFrame, { category, tags, visibility, dryRun }) {
  const openPanelBtn = editorFrame.getByRole('button', SELECTORS.publishButton).first();
  await openPanelBtn.click();

  if (category) {
    try {
      await editorFrame.getByText(category, { exact: true }).first().click({ timeout: 5000 });
    } catch (err) {
      console.warn(`⚠️  카테고리(${category})를 찾지 못해 건너뜁니다:`, err.message);
    }
  }

  await fillTags(editorFrame, tags);
  await setVisibility(editorFrame, visibility);

  if (dryRun) {
    console.log('🔎 dryRun 모드: 실제 발행 버튼은 누르지 않습니다.');
    return;
  }

  const confirmBtn = editorFrame.getByRole('button', SELECTORS.publishButton).last();
  await confirmBtn.click();

  // 발행 처리는 비동기로 몇 초 걸릴 수 있어, URL이 글 보기 화면으로 바뀔 때까지 대기
  await page.waitForURL(/PostView|logNo=/, { timeout: 20000 }).catch(() => {
    console.warn('⚠️  발행 후 URL 전환을 확인하지 못했습니다. 수동으로 발행 여부를 확인해주세요.');
  });
}

/**
 * 글 작성 → (옵션) 발행까지 한 번에 수행.
 * @param {{title:string, body:string, tags?:string[], visibility?:'all'|'neighbor'|'me', category?:string, dryRun?:boolean}} post
 */
export async function publishPost(post) {
  const { title, body } = post;
  if (!title || !body) {
    throw new Error('title 과 body 는 필수입니다.');
  }

  const { browser, page } = await launch();
  try {
    const editorFrame = await openWritePage(page);

    await fillTitle(page, editorFrame, title).catch(async (err) => {
      await screenshotOnError(page, 'fill-title');
      throw err;
    });

    await fillBody(page, editorFrame, body).catch(async (err) => {
      await screenshotOnError(page, 'fill-body');
      throw err;
    });

    await publishFlow(page, editorFrame, post).catch(async (err) => {
      await screenshotOnError(page, 'publish-flow');
      throw err;
    });

    console.log(post.dryRun ? '✅ 작성 완료 (발행은 생략됨).' : '✅ 발행 완료.');
  } finally {
    await browser.close();
  }
}
