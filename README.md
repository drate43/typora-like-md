# Markview

Markview는 Markdown 문서를 작고 빠르게 열어, 읽기 좋은 렌더페이지에서 그대로 쓰고 고칠 수 있게 만든 macOS용 문서 앱입니다. 핵심은 **예쁘게 읽기**, **렌더 화면에서 바로 쓰기**, **원문을 필요할 때만 확인하기**입니다.

Typora처럼 미리보기와 편집을 오가지 않아도 되고, 무거운 IDE처럼 프로젝트 기능이 앞에 나서지 않도록 문서 읽기 경험을 중심에 둡니다. 원문보기는 유지하되 기본 작업 공간은 렌더페이지입니다.

## 주요 기능

* ProseMirror/Milkdown 기반 단일 화면 WYSIWYG 편집

* `.md`, `.markdown`, `.mdown`, `.mkd`, `.txt` 열기

* Typora 라이트, 소프트 라이트, Nord, Tokyo Night, WebStorm, JetBrains Darcula, VS Code, One Dark Pro, Catppuccin Mocha, Gruvbox Dark, Solarized Dark 계열 테마

* 오른쪽 목차 패널, 폭 조절, 현재 섹션 하이라이트

* cmux처럼 마우스로 조절하는 탭형 오른쪽 문서 패널

* 열기, 저장, 다른 이름으로 저장, 자동 저장

* 작업 폴더의 Markdown 파일 트리와 파일명/문서 제목 표시 전환

* 작업 폴더 안에서 새 Markdown 파일 생성

* 새 폴더 생성

* 현재 문서 이름 변경

* 현재 문서를 macOS 휴지통으로 이동

* 마지막 작업 폴더 자동 복원

* 최근 문서 최대 20개 보관

* 파일 이름과 본문을 대상으로 한 폴더 전체 검색

* 검색 결과의 문서·줄 번호·본문 미리보기 표시

* 검색 결과를 열고 일치 텍스트로 커서 이동

* Mermaid 렌더링 및 같은 자리 소스 편집

* KaTeX 인라인·블록 수식

* GFM 표, 체크박스, 취소선, 링크, 이미지

* YAML Front Matter 보존 및 편집

* 문서 목차, 타자기 모드

* Markdown 원문 모드

* `markview .`, `markview ./file.md` 터미널 열기
* 짧은 CLI 별칭 `mdv .`, `mdv ./file.md`

* 파일 연결 및 드래그 앤 드롭 열기

* `.app` 및 `.dmg` 번들 설정

## 작업 폴더 사용

상단의 **폴더** 버튼 또는 `⇧⌘O`를 눌러 폴더를 선택합니다.

왼쪽 사이드바는 다음 탭으로 구성됩니다.

| 탭  | 기능                                                |
| -- | ------------------------------------------------- |
| 파일 | 폴더 구조 탐색, 문서 열기, 새 파일/폴더 생성, 이름 변경, 휴지통 이동, 새로 고침 |
| 최근 | 최근 연 문서 다시 열기 및 목록 관리                             |
| 검색 | 작업 폴더 안 파일 이름·본문 전체 검색                            |

검색은 `⇧⌘F`로 바로 열 수 있습니다. 두 글자 이상 입력하면 자동으로 검색합니다.

성능과 불필요한 결과 방지를 위해 숨김 폴더와 `node_modules`, `target`, `dist`, `build`, `coverage`, `vendor` 등은 제외합니다. 한 작업 폴더에서는 최대 5,000개 문서를 탐색하며, 4MB보다 큰 파일은 본문 검색에서 건너뜁니다.

## 개발 환경

macOS에 다음 항목이 필요합니다.

* Node.js 22 이상

* Rust stable

* Xcode Command Line Tools

```bash
unzip Markview_0.7.109_aarch64_dmg.zip
cd markview
xcode-select --install
rustup update stable
npm ci
npm run tauri:dev
```

브라우저 UI만 확인할 때는 다음 명령을 사용합니다. 파일 시스템 기능은 Tauri 앱에서 동작합니다.

```bash
npm run dev
```

## DMG 만들기

DMG는 macOS에서 생성할 수 있습니다.

```bash
npm ci
npm run tauri:build -- --bundles dmg,app
```

결과 파일:

```text
src-tauri/target/release/bundle/dmg/*.dmg
src-tauri/target/release/bundle/macos/*.app
```

## GitHub Actions로 DMG 만들기

프로젝트를 GitHub 저장소에 올린 뒤 **Actions → Build macOS DMG → Run workflow**를 실행합니다. `v0.7.0` 같은 태그를 push해도 빌드가 시작됩니다.

생성된 macOS artifact 안에서 unsigned DMG와 `.app`을 받을 수 있습니다.

## 주요 단축키

| 동작            | 단축키          |
| ------------- | ------------ |
| 새 문서          | `⌘N`         |
| 파일 열기         | `⌘O`         |
| 작업 폴더 열기      | `⇧⌘O`        |
| 저장            | `⌘S`         |
| 다른 이름으로 저장    | `⇧⌘S`        |
| 작업 폴더 전체 검색   | `⇧⌘F`        |
| 원문 모드 전환      | `⌘/`         |
| 실행 취소 / 다시 실행 | `⌘Z` / `⇧⌘Z` |

## 파일 관리

작업 폴더를 연 뒤 왼쪽 파일 탭의 아이콘 버튼을 사용할 수 있습니다. 각 아이콘은 마우스를 올리면 툴팁으로 기능 이름이 표시됩니다.

* 새 파일은 현재 열려 있는 문서와 같은 폴더에 생성됩니다. 현재 문서가 작업 폴더 밖에 있으면 작업 폴더 루트에 생성됩니다.

* 새 폴더도 같은 기준의 위치에 생성됩니다.

* 이름 변경과 휴지통 이동은 현재 열려 있는 작업 폴더 안 문서에 적용됩니다.

* 삭제 버튼은 영구 삭제하지 않고 OS 휴지통으로 이동합니다. 실수로 이동한 파일은 Finder 휴지통에서 복원할 수 있습니다.

## Mermaid 편집

`mermaid` fenced code block은 평소 SVG 다이어그램으로 표시됩니다. 다이어그램을 클릭하면 같은 블록 아래에 소스가 열리고, 편집 내용이 잠시 후 다이어그램에 반영됩니다. `Esc` 또는 블록 바깥 클릭으로 소스를 접을 수 있습니다.

## 배포 전 확인 사항

현재 설정은 로컬 설치 및 테스트용 unsigned DMG를 만듭니다. 다른 사용자에게 macOS 경고 없이 배포하려면 Apple Developer ID 서명과 Notarization 설정이 추가로 필요합니다.

이 프로젝트는 공개 오픈소스 구성요소로 읽기 중심 Markdown 경험을 구현한 독립 프로젝트입니다.
