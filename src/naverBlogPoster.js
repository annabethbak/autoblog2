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
  // 본문 문단. 개발자도구로 실제 DOM을 확인한 결과, 본문 문단은
  //   .se-section.se-section-text > .se-module.se-module-text > .se-text-paragraph
  // 구조였다. `.se-text-paragraph` 클래스 자체는 있었지만, 이전에 쓰던
  // 조상 스코프(.se-main-container .se-component.se-text 등)가 실제 구조와
  // 안 맞아서 매번 0개 매칭 → 타임아웃이었던 것. `.se-section-text` 로만
  // 스코프해서 제목 문단(.se-documentTitle, se-section-text 클래스 없음)은
  // 자연스럽게 제외한다.
  bodyParagraph: '.se-section-text .se-text-paragraph',
  // 발행 버튼 왼쪽의 임시저장 버튼 (스크린샷엔 "저장 7" 처럼 숫자 배지와 같이 표시됨)
  saveButton: { role: 'button', name: /저장/ },
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
 * ⚠️ 개발자도구로 실제 DOM을 확인해 잡은 버그:
 * `.se-text-paragraph` 클래스 자체는 처음부터 존재했다. 문제는 이전에 쓰던
 * 조상 스코프(.se-main-container .se-component.se-text 등)가 실제 구조와
 * 안 맞아서 매번 0개 매칭 → 타임아웃이었던 것. 실제 구조는:
 *   .se-section.se-section-text > .se-module.se-module-text > .se-text-paragraph
 * 이라서, SELECTORS.bodyParagraph 는 `.se-section-text .se-text-paragraph`
 * 로 스코프한다 (제목은 .se-documentTitle 래퍼를 쓰고 se-section-text
 * 클래스가 없어 자연히 제외됨).
 *
 * 문단 안에는 실제 텍스트가 들어갈 span과 placeholder용 span(.se-placeholder)
 * 이 같이 있는데, 그 자식 span이 아니라 문단(<p class="se-text-paragraph">)
 * 자체를 클릭 대상으로 삼는다 — placeholder 문구는 매번 랜덤하게 바뀔 수
 * 있어 특정 문자열에 의존하지 않기 위함이다.
 *
 * 혹시 SELECTORS.bodyParagraph 가 안 맞는 에디터 변형을 만나면, 최후의
 * 수단으로 iframe 전체에서 `.se-text-paragraph` 를 모두 찾아 첫 번째(보통
 * 제목)를 건너뛴 두 번째 요소를 시도한다. 이건 순서에 기대는 추측이라
 * 확실하진 않으니, 이 경로를 타면 경고를 남긴다.
 */
async function fillBody(page, editorFrame, bodyText) {
  let clickTarget = editorFrame.locator(SELECTORS.bodyParagraph).first();
  try {
    await clickTarget.waitFor({ state: 'visible', timeout: 10000 });
  } catch {
    console.warn(
      `⚠️  ${SELECTORS.bodyParagraph} 를 못 찾았습니다. ` +
        '최후의 수단으로 .se-text-paragraph 중 두 번째 요소(제목 다음)를 시도합니다.'
    );
    clickTarget = editorFrame.locator('.se-text-paragraph').nth(1);
    await clickTarget.waitFor({ state: 'visible', timeout: 5000 });
  }
  await clickTarget.click();

  const lines = bodyText.split('\n');
  for (let i = 0; i < lines.length; i++) {
    await page.keyboard.type(lines[i], { delay: 10 });
    if (i < lines.length - 1) {
      await page.keyboard.press('Enter');
    }
  }

  // silent failure 방지: 실제로 반영됐는지 (클릭했던 그 요소 기준으로) 확인
  const typedText = await clickTarget.innerText().catch(() => '');
  if (!typedText.trim()) {
    throw new Error(
      '본문을 입력했지만 에디터에 반영되지 않았습니다. ' +
        'debug/ 스크린샷과 SELECTORS.bodyParagraph 값을 실제 DOM과 대조해 확인해주세요.'
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
 * "도움말" 패널이 열려 있으면 닫는다. 이 패널이 발행 버튼 위에 떠서 클릭을
 * 가로채는(intercepts pointer events) 경우가 있어, 발행 관련 버튼을 클릭
 * 하기 직전마다 호출한다.
 *
 * 패널 컨테이너 클래스(container__HW_tc 같은 것)는 CSS 모듈 해시라 빌드마다
 * 바뀔 수 있어 의존하지 않는다. 대신:
 *   1) 접근성 라벨 기준으로 닫기(X) 버튼을 먼저 찾아 클릭
 *   2) 못 찾으면 Escape 키로 닫기 시도
 * 둘 다 실패해도 에러는 던지지 않고 경고만 남긴다 — 패널이 애초에 없었을
 * 수도 있고, 이어지는 클릭이 실패하면 그쪽에서 스크린샷과 함께 에러가 난다.
 */
async function dismissHelpPanel(page, editorFrame) {
  const helpTitle = editorFrame.locator('h1.se-help-title', { hasText: '도움말' }).first();

  let isOpen = false;
  try {
    isOpen = await helpTitle.isVisible({ timeout: 1000 });
  } catch {
    isOpen = false;
  }
  if (!isOpen) return;

  console.warn('⚠️  "도움말" 패널이 열려 있어 닫습니다 (발행 버튼을 가리고 있을 수 있음).');

  let closed = false;
  try {
    // 닫기 버튼은 보통 "닫기" 접근성 라벨을 가진 X 아이콘 버튼이다.
    await editorFrame.getByRole('button', { name: /닫기|close/i }).first().click({ timeout: 2000 });
    closed = true;
  } catch {
    // 아래 Escape 폴백으로 진행
  }

  if (!closed) {
    await page.keyboard.press('Escape').catch(() => {});
  }

  await helpTitle.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {
    console.warn('⚠️  도움말 패널이 안 닫힌 것 같습니다. 이어지는 클릭이 실패할 수 있어요.');
  });
}

/**
 * "저장" 버튼(발행 버튼 왼쪽의 임시저장, 스크린샷의 "저장 7")만 클릭한다.
 * --dry-run 테스트용: 제목/본문이 에디터에 잘 반영됐는지 임시저장으로
 * 확인하고 끝내고 싶을 때 쓴다. 발행 버튼에는 절대 손대지 않는다.
 */
async function clickSaveDraft(page, editorFrame) {
  await dismissHelpPanel(page, editorFrame);
  const saveBtn = editorFrame.getByRole('button', SELECTORS.saveButton).first();
  await saveBtn.click();
}

/**
 * 상단 "발행" 버튼 → 발행 설정 패널 → 패널 안의 최종 "발행" 버튼까지 클릭한다.
 * 패널이 열리면 화면에 "발행" 텍스트를 가진 버튼이 2개(툴바용 + 패널 확정용)
 * 존재할 수 있어, 패널이 열린 뒤 나타나는 마지막 버튼을 최종 발행으로 간주한다.
 * 실제 DOM에서 다르면 이 함수의 로케이터만 교체하면 된다.
 *
 * ⚠️ dry-run 에서는 이 함수 자체를 호출하지 않는다 (publishPost 참고) —
 * 발행 버튼 클릭 로직은 아직 손보는 중이라, 테스트 중에 실수로라도 눌리는
 * 일이 없도록 아예 경로를 분리해뒀다.
 */
async function publishFlow(page, editorFrame, { category, tags, visibility }) {
  await dismissHelpPanel(page, editorFrame);

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

  await dismissHelpPanel(page, editorFrame);

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

    if (post.dryRun) {
      // 발행 버튼 로직은 아직 다듬는 중이라, dry-run 에서는 publishFlow를
      // 아예 호출하지 않고 저장 버튼만 눌러서 끝낸다 (발행 버튼 미터치 보장).
      await clickSaveDraft(page, editorFrame).catch(async (err) => {
        await screenshotOnError(page, 'click-save-draft');
        throw err;
      });
      console.log('✅ dryRun: 저장 버튼까지 클릭 완료 (발행 버튼은 누르지 않았습니다).');
      return;
    }

    await publishFlow(page, editorFrame, post).catch(async (err) => {
      await screenshotOnError(page, 'publish-flow');
      throw err;
    });

    console.log('✅ 발행 완료.');
  } finally {
    await browser.close();
  }
}
