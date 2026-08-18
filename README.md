# autoblog2

네이버 블로그 글쓰기 화면(SmartEditor ONE)에 Playwright로 제목/본문을 입력하고
발행까지 자동화하는 도구입니다.

## 동작 방식

1. `npm run login` — 화면이 보이는(headed) 브라우저가 뜨고, **직접** 네이버에
   로그인합니다(아이디/비번, 2단계 인증, 캡차 모두 사람이 처리). 로그인 후
   터미널에서 Enter를 누르면 로그인 세션(쿠키)이 `auth/naver-storage.json`
   에 저장됩니다.
2. `npm run publish -- --title "..." --body-file ./post.txt` — 저장해둔
   세션으로 글쓰기 페이지(`blog.naver.com/<BLOG_ID>?Redirect=Write&`)를 열고,
   제목/본문을 입력한 뒤 발행 버튼까지 클릭합니다.

아이디/비밀번호를 스크립트에 넣어 자동 로그인하지 않는 이유는, 네이버가
반복적인 자동 로그인을 봇으로 간주해 캡차를 띄우는 경우가 많기 때문입니다.
사람이 한 번 로그인한 세션을 재사용하는 쪽이 훨씬 안정적입니다.

## 설치

```bash
npm install
cp .env.example .env
# .env 열어서 BLOG_ID 등을 채워주세요.
```

## 사용법

```bash
npm run login
npm run publish -- --title "오늘의 회고" --body-file ./post.txt --tags "회고,일상" --visibility all
```

전체 옵션은 [`scripts/publish-post.js`](./scripts/publish-post.js) 상단 주석 참고.

`--dry-run` 을 붙이면 제목/본문/태그까지만 입력하고 최종 발행 버튼은 누르지
않습니다. 처음 셀렉터를 검증할 때 이 옵션으로 먼저 확인하는 것을 권장합니다.

## ⚠️ 알아두어야 할 점

- **이 셀렉터들은 라이브로 검증되지 않았습니다.** 이 코드는 지금 세션(원격
  컨테이너) 안에서 작성됐는데, 이 컨테이너의 아웃바운드 네트워크 정책이
  `naver.com` 접속 자체를 막고 있어(조직 egress 정책 403) 실제 화면에 붙여
  셀렉터를 검증할 수 없었습니다. `src/naverBlogPoster.js` 는 캡처해주신
  화면 구조와 SmartEditor ONE의 알려진 DOM 패턴을 바탕으로 작성했고,
  가능한 한 CSS 해시 클래스보다 role/placeholder/text 기반의 안정적인
  로케이터를 우선 사용했지만, 실제 배포에서 조금씩 다를 수 있습니다.
- **로컬(또는 naver.com에 접속 가능한 환경)에서 먼저 검증하세요.** 아래
  명령으로 실제 DOM을 보면서 셀렉터를 뽑아 `src/naverBlogPoster.js` 의
  `SELECTORS` 값을 맞는 값으로 교체하면 됩니다.
  ```bash
  npx playwright codegen https://blog.naver.com/<BLOG_ID>?Redirect=Write&
  ```
- 실패 시 `debug/` 폴더에 그 시점 스크린샷이 자동 저장되니, 어느 단계에서
  막혔는지 확인할 때 참고하세요.
- 사진/동영상/스티커/표/인용구 등 리치 콘텐츠 삽입은 아직 구현하지
  않았습니다(제목 + 텍스트 본문 + 태그 + 공개설정 + 카테고리까지만 지원).
  필요하면 `naverBlogPoster.js` 에 함수를 추가하는 방식으로 확장하면 됩니다.
- `auth/naver-storage.json` 에는 로그인 세션이 담겨 있으므로 `.gitignore`
  에 이미 제외되어 있습니다. 절대 커밋/공유하지 마세요.
