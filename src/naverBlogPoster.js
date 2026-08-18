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
  // id="mainFrame" 뿐 아니라 name="mainFrame" 으로만 잡히는 경우도 있어 둘 다 매칭한다.
  editorFrame: 'iframe[name="mainFrame"], iframe#mainFrame',
  // 제목 입력 영역 (문서 제목 컴포넌트)
  title: '.se-documentTitle .se-text-paragraph',
  // 본문 영역: 문서 제목 컴포넌트(.se-documentTitle)를 제외한 첫 번째 컴포넌트.
  // `.se-text-paragraph` 로 본문 문단을 직접 찾는 방식은 codegen으로 확인한
  // 결과 실제로 존재하지 않아 타임아웃만 났다 — 클래스명에 의존하지 않는
  // 구조적 셀렉터로 대체 (fillBody 주석 참고).
  bodyArea: '.se-main-container .se-component:not(.se-documentTitle)',
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

/**
 * 본문 입력. 여러 줄이면 줄바꿈마다 새 문단(Enter)으로 나눠 입력한다.
 *
 * ⚠️ codegen으로 확인된 실제 동작:
 * `.se-text-paragraph` 클래스로 본문 문단을 직접 찾는 방식은 타임아웃만
 * 나고 실제로는 못 찾는다. 반대로 본문 영역에 표시되는 placeholder/글감
 * 추천 텍스트(예: "나를 돌아보는 회고, 뜻밖의 발견을 기다립니다. #모두의회고")를
 * getByText 로 클릭하면 확실하게 포커스가 잡힌다.
 *
 * 다만 그 문구는 매번 랜덤하게 바뀔 수 있어 정확한 문자열에 의존하면 또
 * 깨지기 쉽다. 그래서:
 *   1) 문서 제목 컴포넌트(.se-documentTitle)를 제외한 본문 영역
 *      (SELECTORS.bodyArea) 안에서, "보이는 텍스트가 있는 아무 요소"를
 *      느슨한 정규식(/\S/)으로 찾아 클릭한다 — 특정 문구가 아니라
 *      "본문 영역 안의 텍스트"라는 구조적 특징만 사용하므로 placeholder
 *      문구가 바뀌어도 그대로 동작한다.
 *   2) 그 텍스트조차 없으면(이미 내용이 있어 placeholder가 안 보이는 등)
 *      본문 컴포넌트 컨테이너 자체를 클릭하는 걸로 폴백한다.
 *   3) 클릭이 성공하면 바로 page.keyboard.type() 으로 타이핑하고, 끝난 뒤
 *      실제로 반영됐는지 읽어 확인한다. 비어 있으면 조용히 넘어가지 않고
 *      에러를 던진다.
 */
async function fillBody(page, editorFrame, bodyText) {
  const bodyArea = editorFrame.locator(SELECTORS.bodyArea).first();
  await bodyArea.waitFor({ state: 'attached', timeout: 10000 });

  let clickTarget = bodyArea.getByText(/\S/).first();
  try {
    await clickTarget.waitFor({ state: 'visible', timeout: 3000 });
  } catch {
    // placeholder 텍스트가 안 보이면 컨테이너 자체를 클릭
    clickTarget = bodyArea;
  }
  await clickTarget.click();

  const lines = bodyText.split('\n');
  for (let i = 0; i < lines.length; i++) {
    await page.keyboard.type(lines[i], { delay: 10 });
    if (i < lines.length - 1) {
      await page.keyboard.press('Enter');
    }
  }

  // silent failure 방지: 실제로 반영됐는지 iframe 컨텍스트 안에서 확인
  const typedText = await bodyArea.innerText().catch(() => '');
  if (!typedText.trim()) {
    throw new Error(
      '본문을 입력했지만 에디터에 반영되지 않았습니다. ' +
        'debug/ 스크린샷과 SELECTORS.bodyArea 값을 실제 DOM과 대조해 확인해주세요.'
    );
  }
}

/**
 * 태그 입력 (옵션).
 * 네이버 에디터는 입력 필드에서 붙여넣기/fill() 을 막아놓은 경우가 있어,
 * 제목·본문과 마찬가지로 클릭 후 키보드 타이핑 방식으로 입력한다.
 * (Enter로 태그가 확정되면 입력창은 보통 자동으로 비워진다.)
 */
async function fillTags(page, editorFrame, tags = []) {
  if (!tags.length) return;
  try {
    const tagInput = editorFrame.getByPlaceholder(SELECTORS.tagInput);
    await tagInput.waitFor({ state: 'visible', timeout: 5000 });
    for (const tag of tags) {
      await tagInput.click();
      await page.keyboard.type(tag, { delay: 10 });
      await page.keyboard.press('Enter');
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

  await fillTags(page, editorFrame, tags);
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
