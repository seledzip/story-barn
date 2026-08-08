# 이야기 곳간 — Vercel 배포 가이드

코딩 지식 없이도 따라할 수 있도록 순서대로 정리했습니다.

## 준비물
1. GitHub 계정 (무료) — github.com
2. Vercel 계정 (무료) — vercel.com (GitHub로 가입하면 편함)
3. Anthropic API 키 (유료, 결제수단 등록 필요) — console.anthropic.com
4. 기존에 발급받은 YouTube Data API 키

## 1단계 — GitHub에 코드 올리기
1. github.com 접속 → 로그인 → 우측 상단 `+` → `New repository`
2. 이름은 자유롭게 (예: `story-barn`) → `Create repository`
3. 생성된 빈 저장소 페이지에서 `uploading an existing file` 링크 클릭
4. 이 압축을 풀어서 나온 `story-barn` 폴더 전체를 브라우저 창에 드래그 앤 드롭
   (폴더째로 끌어다 놓으면 `api` 폴더 구조가 그대로 유지됩니다)
5. 하단 `Commit changes` 클릭

## 2단계 — Anthropic API 키 발급
1. console.anthropic.com 접속 → 로그인/가입
2. 결제수단 등록 (Billing) — 사용한 만큼만 과금되며, 이 앱은 대본 1개당 매우 적은 비용이 듭니다
3. `API Keys` 메뉴 → `Create Key` → 생성된 키 복사해두기 (다시 볼 수 없으니 꼭 복사)

## 3단계 — Vercel에 배포
1. vercel.com 접속 → `Continue with GitHub`로 로그인
2. `Add New...` → `Project`
3. 방금 만든 `story-barn` 저장소 선택 → `Import`
4. `Environment Variables` 섹션에서 추가:
   - Name: `ANTHROPIC_API_KEY` / Value: 2단계에서 복사한 키
5. `Deploy` 클릭 → 1~2분 후 배포 완료, 고유 URL(예: `story-barn.vercel.app`)이 발급됩니다

## 4단계 — 실제 사용
1. 발급된 URL 접속
2. "소재 탐색" 탭에서 기존 YouTube Data API 키 입력 → 저장
3. 채널 추가 후 정상적으로 목록이 뜨는지 확인 (이제 브라우저 제약이 없어서 정상 작동해야 합니다)
4. "대본 짓기" 탭에서 대본 생성 테스트

## 문제가 생기면
- 소재 탐색이 안 될 때: YouTube API 키가 올바른지, Google Cloud에서 YouTube Data API v3가 "사용 설정"되어 있는지 확인
- 대본 짓기가 안 될 때: Vercel 프로젝트의 Environment Variables에 `ANTHROPIC_API_KEY`가 정확히 등록되어 있는지, Anthropic 계정에 결제수단이 등록되어 있는지 확인
- 코드를 수정한 뒤에는 GitHub에 다시 업로드하면 Vercel이 자동으로 재배포합니다
