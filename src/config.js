import 'dotenv/config';
import path from 'node:path';

function required(name, value) {
  if (!value) {
    throw new Error(
      `환경변수 ${name} 가 설정되지 않았습니다. .env.example 을 복사해 .env 를 만들고 값을 채워주세요.`
    );
  }
  return value;
}

export const config = {
  blogId: required('BLOG_ID', process.env.BLOG_ID),
  storageStatePath: path.resolve(
    process.cwd(),
    process.env.STORAGE_STATE_PATH || './auth/naver-storage.json'
  ),
  headless: process.env.HEADLESS === 'true',
  // 이 컨테이너처럼 사전 설치된 크로미움 경로를 강제로 지정해야 하는 환경을 위한 옵션.
  // 로컬 PC에서 `npx playwright install chromium` 을 정상적으로 실행했다면 비워둬도 됩니다.
  chromiumExecutablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
};

export const urls = {
  login: 'https://nid.naver.com/nidlogin.login',
  write: (blogId) => `https://blog.naver.com/${blogId}?Redirect=Write&`,
};
